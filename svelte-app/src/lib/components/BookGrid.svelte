<script lang="ts">
  import type { Book, Folder } from '../types';
  import BookCard from './BookCard.svelte';

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

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
      <div class="folder-item" onclick={(e) => handleFolderClick(folder, e)}>
        <span class="item-icon">&#x1F4C1;</span>
        <span class="item-title">{folder.name}</span>
        <div class="item-actions">
          <button class="item-btn" title="Rename" onclick={(e) => handleFolderRename(folder, e)}>&#x270F;</button>
          <button class="item-btn item-btn-danger" title="Delete" onclick={(e) => handleFolderDelete(folder, e)}>&#x2715;</button>
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

  .folder-item {
    width: 100%;
    background: var(--m-bg-1);
    padding: 10px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--m-accent);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .folder-item:hover { background: var(--m-bg-2); }
  .item-title {
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .folder-item:hover .item-actions { opacity: 1; }
  @media (hover: none) {
    .item-actions { opacity: 0.7; }
  }

  .item-btn {
    background: none;
    border: 1px solid var(--m-border-light);
    color: var(--m-fg-muted);
    width: 26px;
    height: 26px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .item-btn:hover { border-color: var(--m-accent); color: var(--m-accent); }
  .item-btn-danger:hover { border-color: var(--m-error); color: var(--m-error); }

  .library-empty {
    width: 100%;
    color: var(--m-fg-dim);
    font-size: 14px;
    padding: 40px 0;
    text-align: center;
  }
</style>
