import type { BookMeta, Folder } from '../types';
import type { ToolRegistrar, ToolRegistrationHelpers } from './tools-shared';
import { buildLibraryTree } from './library-tree';
import { log } from './logger';

/** Find and repair orphaned books (books whose folder_id points to a non-existent folder).
 *  Returns the list of repaired book titles so callers can report what happened. */
export async function repairOrphans(helpers: ToolRegistrationHelpers): Promise<string[]> {
  const [books, folders] = await Promise.all([helpers.getAllBooksMeta(), helpers.getAllFolders()]);
  const folderIds = new Set(folders.map(f => f.id));
  const orphans = books.filter(b => b.folder_id && !folderIds.has(b.folder_id));
  if (orphans.length === 0) return [];
  const fixed: BookMeta[] = orphans.map(b => ({ ...b, folder_id: null }));
  await helpers.saveBooksMetaBatch(fixed);
  const titles = orphans.map(b => b.title);
  log('LIBRARY', `repaired ${orphans.length} orphan book(s): ${titles.join(', ')}`);
  return titles;
}

/** Format a short suffix describing orphan-repair results, for inclusion in tool result strings. */
export function orphanSuffix(titles: string[]): string {
  if (titles.length === 0) return '';
  const preview = titles.slice(0, 3).join(', ');
  const more = titles.length > 3 ? ` (+${titles.length - 3} more)` : '';
  return ` [Integrity check: auto-repaired ${titles.length} orphan(s) back to root: ${preview}${more}]`;
}

export function registerLibraryTools(register: ToolRegistrar, helpers: ToolRegistrationHelpers): void {
  register({
    name: 'get_library',
    description: 'Get the full library tree showing all folders and books with their IDs, sizes, and page counts.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const [books, folders] = await Promise.all([
        helpers.getAllBooksMeta(),
        helpers.getAllFolders(),
      ]);
      return buildLibraryTree(books, folders) || '(empty library)';
    },
  });

  register({
    name: 'rename_book',
    description: 'Rename a book in the library.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'Book ID' },
        new_title: { type: 'string', description: 'New title' },
      },
      required: ['book_id', 'new_title'],
    },
    handler: async ({ book_id, new_title }: { book_id: string; new_title: string }) => {
      const meta = await helpers.getBookMeta(book_id);
      if (!meta) return `Error: book "${book_id}" not found`;
      await helpers.updateBookMeta(book_id, { title: new_title });
      return `Renamed to "${new_title}"`;
    },
  });

  register({
    name: 'move_book',
    description: 'Move a book into a folder, or to root (folder_id = null).',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'Book ID' },
        folder_id: {
          type: ['string', 'null'],
          description: 'Target folder ID, or null for root',
        },
      },
      required: ['book_id', 'folder_id'],
    },
    handler: async ({ book_id, folder_id }: { book_id: string; folder_id: string | null }) => {
      const meta = await helpers.getBookMeta(book_id);
      if (!meta) return `Error: book "${book_id}" not found`;
      let destName = 'root';
      if (folder_id) {
        const folder = await helpers.getFolder(folder_id);
        if (!folder) return `Error: folder "${folder_id}" not found`;
        destName = `folder "${folder.name}"`;
      }
      await helpers.updateBookMeta(book_id, { folder_id: folder_id || null });
      const repaired = await repairOrphans(helpers);
      const allMeta = await helpers.getAllBooksMeta();
      const destCount = allMeta.filter(b => (b.folder_id || null) === (folder_id || null)).length;
      return `Moved "${meta.title}" to ${destName}. ${destName} now contains ${destCount} book(s).${orphanSuffix(repaired)}`;
    },
  });

  register({
    name: 'delete_book',
    description: 'Delete a book from the library permanently.',
    parameters: {
      type: 'object',
      properties: { book_id: { type: 'string', description: 'Book ID' } },
      required: ['book_id'],
    },
    handler: async ({ book_id }: { book_id: string }) => {
      const meta = await helpers.getBookMeta(book_id);
      if (!meta) return `Error: book "${book_id}" not found`;
      await helpers.deleteBook(book_id);
      helpers.deleteChat(book_id);
      helpers.deleteBookData(book_id);
      const remaining = (await helpers.getAllBooksMeta()).length;
      return `Deleted "${meta.title}". ${remaining} book(s) remain in the library.`;
    },
  });

  register({
    name: 'create_folder',
    description: 'Create a new folder. Optionally nest inside a parent folder.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_id: {
          type: ['string', 'null'],
          description: 'Parent folder ID, or null for root',
        },
      },
      required: ['name'],
    },
    handler: async ({ name, parent_id }: { name: string; parent_id?: string | null }) => {
      if (parent_id) {
        const parent = await helpers.getFolder(parent_id);
        if (!parent) return `Error: parent folder "${parent_id}" not found`;
      }
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      await helpers.saveFolder({ id, name, parent_id: parent_id || null, createdAt: Date.now() });
      return `Created folder "${name}"\nfolder_id: ${id}\nUse this folder_id to move books into it.`;
    },
  });

  register({
    name: 'rename_folder',
    description: 'Rename a folder.',
    parameters: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: 'Folder ID' },
        new_name: { type: 'string', description: 'New name' },
      },
      required: ['folder_id', 'new_name'],
    },
    handler: async ({ folder_id, new_name }: { folder_id: string; new_name: string }) => {
      const folder = await helpers.getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
      folder.name = new_name;
      await helpers.saveFolder(folder);
      return `Renamed folder to "${new_name}"`;
    },
  });

  async function reparentFolderContents(
    folderId: string,
    newParentId: string | null
  ): Promise<{ books: BookMeta[]; folders: Folder[] }> {
    // Clone the filtered records so we don't mutate reactive state in place.
    const allMeta = await helpers.getAllBooksMeta();
    const booksToSave: BookMeta[] = allMeta
      .filter(b => b.folder_id === folderId)
      .map(b => ({ ...b, folder_id: newParentId }));
    if (booksToSave.length > 0) await helpers.saveBooksMetaBatch(booksToSave);

    const folders = await helpers.getAllFolders();
    const foldersToSave: Folder[] = folders
      .filter(f => f.parent_id === folderId)
      .map(f => ({ ...f, parent_id: newParentId }));
    if (foldersToSave.length > 0) await helpers.saveFolders(foldersToSave);

    return { books: booksToSave, folders: foldersToSave };
  }

  register({
    name: 'delete_folder',
    description:
      'Delete a folder. Refuses to delete a non-empty folder unless recursive=true. ' +
      'When recursive=true, contents (books and subfolders) are moved to the parent folder before deletion.',
    parameters: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: 'Folder ID' },
        recursive: {
          type: 'boolean',
          description:
            'If true, reparent contents to the parent folder before deletion. ' +
            'If false or omitted, the folder must be empty or the call will fail.',
        },
      },
      required: ['folder_id'],
    },
    handler: async ({
      folder_id,
      recursive,
    }: {
      folder_id: string;
      recursive?: boolean;
    }) => {
      const folder = await helpers.getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
      const parentId = folder.parent_id || null;

      const allBooks = await helpers.getAllBooksMeta();
      const allFolders = await helpers.getAllFolders();
      const childBooks = allBooks.filter(b => b.folder_id === folder_id);
      const childFolders = allFolders.filter(f => f.parent_id === folder_id);

      if ((childBooks.length > 0 || childFolders.length > 0) && !recursive) {
        const bookList = childBooks.slice(0, 5).map(b => `"${b.title}"`).join(', ');
        const moreBooks = childBooks.length > 5 ? ` (+${childBooks.length - 5} more)` : '';
        const folderList = childFolders.map(f => `"${f.name}"`).join(', ');
        return (
          `Error: folder "${folder.name}" is not empty ` +
          `(${childBooks.length} book(s), ${childFolders.length} subfolder(s)). ` +
          `To delete anyway, pass recursive=true. ` +
          `Books: ${bookList}${moreBooks}. Subfolders: ${folderList || 'none'}.`
        );
      }

      const reparented = await reparentFolderContents(folder_id, parentId);
      await helpers.deleteFolder(folder_id);
      const repaired = await repairOrphans(helpers);
      const destName = parentId ? `parent folder "${folder.name}"` : 'root';
      const moved =
        reparented.books.length === 0 && reparented.folders.length === 0
          ? ''
          : ` Reparented ${reparented.books.length} book(s) and ${reparented.folders.length} subfolder(s) to ${destName}.`;
      return `Deleted folder "${folder.name}".${moved}${orphanSuffix(repaired)}`;
    },
  });

  register({
    name: 'move_folder',
    description: 'Move a folder to a new parent, or to root (parent_id = null).',
    parameters: {
      type: 'object',
      properties: {
        folder_id: { type: 'string', description: 'Folder ID to move' },
        parent_id: {
          type: ['string', 'null'],
          description: 'New parent folder ID, or null for root',
        },
      },
      required: ['folder_id', 'parent_id'],
    },
    handler: async ({ folder_id, parent_id }: { folder_id: string; parent_id: string | null }) => {
      const folder = await helpers.getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
      if (parent_id) {
        const parent = await helpers.getFolder(parent_id);
        if (!parent) return `Error: parent folder "${parent_id}" not found`;
        let check: string | null = parent_id;
        while (check) {
          if (check === folder_id) return 'Error: cannot move folder into its own descendant';
          const p = await helpers.getFolder(check);
          check = p?.parent_id || null;
        }
      }
      folder.parent_id = parent_id || null;
      await helpers.saveFolder(folder);
      const dest = parent_id ? `"${(await helpers.getFolder(parent_id))!.name}"` : 'root';
      return `Moved folder "${folder.name}" to ${dest}`;
    },
  });

  register({
    name: 'archive_book',
    description: 'Archive or unarchive a book. Archived books are hidden from the library listing.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'Book ID' },
        archived: { type: 'boolean', description: 'true to archive, false to unarchive' },
      },
      required: ['book_id', 'archived'],
    },
    handler: async ({ book_id, archived }: { book_id: string; archived: boolean }) => {
      const meta = await helpers.getBookMeta(book_id);
      if (!meta) return `Error: book "${book_id}" not found`;
      await helpers.updateBookMeta(book_id, { archived });
      return `${archived ? 'Archived' : 'Unarchived'} "${meta.title}"`;
    },
  });

  register({
    name: 'batch_move_books',
    description: 'Move multiple books to a folder in one operation.',
    parameters: {
      type: 'object',
      properties: {
        book_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Book IDs to move',
        },
        folder_id: {
          type: ['string', 'null'],
          description: 'Target folder ID, or null for root',
        },
      },
      required: ['book_ids', 'folder_id'],
    },
    handler: async ({ book_ids, folder_id }: { book_ids: string[]; folder_id: string | null }) => {
      let destName = 'root';
      if (folder_id) {
        const folder = await helpers.getFolder(folder_id);
        if (!folder) return `Error: folder "${folder_id}" not found`;
        destName = `folder "${folder.name}"`;
      }
      const results: string[] = [];
      const metasToSave: BookMeta[] = [];
      for (const id of book_ids) {
        const meta = await helpers.getBookMeta(id);
        if (!meta) {
          results.push(`${id}: not found`);
          continue;
        }
        metasToSave.push({ ...meta, folder_id: folder_id || null });
        results.push(`"${meta.title}": moved`);
      }
      if (metasToSave.length > 0) await helpers.saveBooksMetaBatch(metasToSave);
      const repaired = await repairOrphans(helpers);
      const allMeta = await helpers.getAllBooksMeta();
      const destCount = allMeta.filter(b => (b.folder_id || null) === (folder_id || null)).length;
      return (
        `Moved ${metasToSave.length}/${book_ids.length} book(s) to ${destName}. ` +
        `${destName} now contains ${destCount} book(s).\n${results.join('\n')}${orphanSuffix(repaired)}`
      );
    },
  });

  register({
    name: 'batch_rename_books',
    description: 'Rename multiple books in one operation.',
    parameters: {
      type: 'object',
      properties: {
        renames: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              book_id: { type: 'string' },
              new_title: { type: 'string' },
            },
            required: ['book_id', 'new_title'],
          },
          description: 'Array of {book_id, new_title} pairs',
        },
      },
      required: ['renames'],
    },
    handler: async ({ renames }: { renames: { book_id: string; new_title: string }[] }) => {
      const results: string[] = [];
      const metasToSave: BookMeta[] = [];
      for (const { book_id, new_title } of renames) {
        const meta = await helpers.getBookMeta(book_id);
        if (!meta) {
          results.push(`${book_id}: not found`);
          continue;
        }
        const old = meta.title;
        metasToSave.push({ ...meta, title: new_title });
        results.push(`"${old}" -> "${new_title}"`);
      }
      if (metasToSave.length > 0) await helpers.saveBooksMetaBatch(metasToSave);
      return `Renamed ${metasToSave.length}/${renames.length} book(s):\n${results.join('\n')}`;
    },
  });
}
