<script lang="ts">
  import type { Book, Folder } from '../types';
  import BookCard from './BookCard.svelte';
  import { lsStatsKey } from '../core/constants';

  let {
    books,
    folders,
    currentFolderId,
    onOpenBook,
    onRenameBook,
    onDeleteBook,
    onMoveBook,
    onNavigateFolder,
    onRenameFolder,
    onDeleteFolder,
    onUpload,
  }: {
    books: Book[];
    folders: Folder[];
    currentFolderId: string | null;
    onOpenBook: (book: Book) => void;
    onRenameBook: (book: Book) => void;
    onDeleteBook: (book: Book) => void;
    onMoveBook: (book: Book) => void;
    onNavigateFolder: (folderId: string | null) => void;
    onRenameFolder: (folder: Folder) => void;
    onDeleteFolder: (folder: Folder) => void;
    onUpload: (file: File) => void;
  } = $props();

  let childFolders = $derived(
    folders.filter(f => (f.parent_id || null) === currentFolderId)
  );

  let childBooks = $derived(
    books.filter(b => (b.folder_id || null) === currentFolderId)
  );

  let breadcrumbs = $derived(buildBreadcrumbs(currentFolderId, folders));

  function buildBreadcrumbs(folderId: string | null, allFolders: Folder[]): { id: string | null; name: string }[] {
    const crumbs: { id: string | null; name: string }[] = [];
    let current = folderId;
    while (current) {
      const f = allFolders.find(f => f.id === current);
      if (!f) break;
      crumbs.unshift({ id: f.id, name: f.name });
      current = f.parent_id;
    }
    crumbs.unshift({ id: null, name: 'Library' });
    return crumbs;
  }

  function folderMeta(folderId: string): string {
    // Count books in this folder (and subfolders recursively)
    const folderIds = new Set<string>();
    function collectFolders(id: string) {
      folderIds.add(id);
      for (const f of folders) {
        if (f.parent_id === id) collectFolders(f.id);
      }
    }
    collectFolders(folderId);
    const folderBooks = books.filter(b => b.folder_id && folderIds.has(b.folder_id));
    const count = folderBooks.length;

    let totalCost = 0;
    for (const b of folderBooks) {
      try {
        const raw = localStorage.getItem(lsStatsKey(b.id));
        if (raw) {
          const stats = JSON.parse(raw);
          if (stats.cost > 0) totalCost += stats.cost;
        }
      } catch {}
    }

    const parts: string[] = [];
    parts.push(count === 1 ? '1 book' : `${count} books`);
    if (totalCost > 0) parts.push(`$${totalCost.toFixed(3)}`);
    return parts.join(' \u00B7 ');
  }

  function handleFolderClick(folder: Folder, e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.item-actions')) return;
    onNavigateFolder(folder.id);
  }

  function handleFolderRename(folder: Folder, e: MouseEvent) {
    e.stopPropagation();
    onRenameFolder(folder);
  }

  function handleFolderDelete(folder: Folder, e: MouseEvent) {
    e.stopPropagation();
    onDeleteFolder(folder);
  }

</script>

<div class="library">
  <div class="book-list">
    {#if currentFolderId}
      <div class="library-breadcrumb">
        {#each breadcrumbs as crumb, i}
          {#if i < breadcrumbs.length - 1}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="breadcrumb-item clickable"
              onclick={() => onNavigateFolder(crumb.id)}
            >{crumb.name}</span>
          {:else}
            <span class="breadcrumb-item current">{crumb.name}</span>
          {/if}
          {#if i < breadcrumbs.length - 1}
            <span class="breadcrumb-sep"> / </span>
          {/if}
        {/each}
      </div>
    {/if}

    {#each childFolders as folder}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="m-card" onclick={(e) => handleFolderClick(folder, e)}>
        <div class="m-card-cover folder-cover">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="m-card-info">
          <span class="m-card-title" title={folder.name}>{folder.name}</span>
          <span class="m-card-meta">{folderMeta(folder.id)}</span>
          <div class="item-actions">
            <button class="item-btn" title="Rename" onclick={(e) => handleFolderRename(folder, e)}>&#x270F;</button>
            <button class="item-btn item-btn-danger" title="Delete" onclick={(e) => handleFolderDelete(folder, e)}>&#x2715;</button>
          </div>
        </div>
      </div>
    {/each}

    {#each childBooks as book (book.id)}
      <BookCard
        {book}
        onOpen={onOpenBook}
        onRename={onRenameBook}
        onDelete={onDeleteBook}
        onMove={onMoveBook}
      />
    {/each}

    {#if childFolders.length === 0 && childBooks.length === 0}
      <div class="library-empty">
        {currentFolderId ? 'This folder is empty' : 'No books yet -- upload a PDF to get started'}
      </div>
    {/if}
  </div>
</div>

<style>
  .library {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .book-list {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 20px;
    padding: 0 4px;
  }

  .library-breadcrumb {
    width: 100%;
    padding: 8px 0;
    margin-bottom: 10px;
    font-size: 14px;
    color: var(--m-fg-muted);
  }
  .breadcrumb-item.clickable { color: var(--m-link); cursor: pointer; }
  .breadcrumb-item.clickable:hover { text-decoration: underline; }
  .breadcrumb-item.current { color: var(--m-fg); }
  .breadcrumb-sep { color: var(--m-fg-dim); margin: 0 4px; }

  .folder-cover {
    color: var(--m-accent);
  }

  .library-empty {
    width: 100%;
    color: var(--m-fg-dim);
    font-size: 14px;
    padding: 40px 0;
    text-align: center;
  }
</style>
