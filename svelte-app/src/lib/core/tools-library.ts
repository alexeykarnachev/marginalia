import type { BookMeta } from '../types';
import type { ToolRegistrar, ToolRegistrationHelpers } from './tools-shared';
import { library } from '../state/library.svelte';

export function registerLibraryTools(register: ToolRegistrar, helpers: ToolRegistrationHelpers): void {
  register({
    name: 'get_library',
    description: 'Get the full library tree showing all folders and books with their IDs, sizes, and page counts.',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      return library.libraryTree || '(empty library)';
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
      if (folder_id) {
        const folder = await helpers.getFolder(folder_id);
        if (!folder) return `Error: folder "${folder_id}" not found`;
      }
      await helpers.updateBookMeta(book_id, { folder_id: folder_id || null });
      const dest = folder_id ? `folder "${(await helpers.getFolder(folder_id))!.name}"` : 'root';
      return `Moved "${meta.title}" to ${dest}`;
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
      return `Deleted "${meta.title}"`;
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

  async function reparentFolderContents(folderId: string, newParentId: string | null): Promise<void> {
    const allMeta = await helpers.getAllBooksMeta();
    const booksToSave = allMeta.filter(b => b.folder_id === folderId);
    for (const b of booksToSave) b.folder_id = newParentId;
    await helpers.saveBooksMetaBatch(booksToSave);

    const folders = await helpers.getAllFolders();
    const foldersToSave = folders.filter(f => f.parent_id === folderId);
    for (const f of foldersToSave) f.parent_id = newParentId;
    await helpers.saveFolders(foldersToSave);
  }

  register({
    name: 'delete_folder',
    description: 'Delete a folder. Contents (books and subfolders) move to the parent folder.',
    parameters: {
      type: 'object',
      properties: { folder_id: { type: 'string', description: 'Folder ID' } },
      required: ['folder_id'],
    },
    handler: async ({ folder_id }: { folder_id: string }) => {
      const folder = await helpers.getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
      const parentId = folder.parent_id || null;
      await reparentFolderContents(folder_id, parentId);
      await helpers.deleteFolder(folder_id);
      return `Deleted folder "${folder.name}"`;
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
      if (folder_id) {
        const folder = await helpers.getFolder(folder_id);
        if (!folder) return `Error: folder "${folder_id}" not found`;
      }
      const results: string[] = [];
      const metasToSave: BookMeta[] = [];
      for (const id of book_ids) {
        const meta = await helpers.getBookMeta(id);
        if (!meta) {
          results.push(`${id}: not found`);
          continue;
        }
        meta.folder_id = folder_id || null;
        metasToSave.push(meta);
        results.push(`"${meta.title}": moved`);
      }
      await helpers.saveBooksMetaBatch(metasToSave);
      const dest = folder_id ? `folder "${(await helpers.getFolder(folder_id))!.name}"` : 'root';
      return `Moved ${book_ids.length} book(s) to ${dest}:\n${results.join('\n')}`;
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
        meta.title = new_title;
        metasToSave.push(meta);
        results.push(`"${old}" -> "${new_title}"`);
      }
      await helpers.saveBooksMetaBatch(metasToSave);
      return `Renamed ${renames.length} book(s):\n${results.join('\n')}`;
    },
  });
}
