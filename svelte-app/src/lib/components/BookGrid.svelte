<script lang="ts">
  import type { Book, Folder } from '../types';
  import BookCard from './BookCard.svelte';
  import { lsStatsKey, lsProgressKey } from '../core/constants';

  type SortMode = 'name' | 'date' | 'progress';
  const LS_SORT = 'marginalia_sort';
  const SORT_LABELS: Record<SortMode, string> = { name: 'A-Z', date: 'New', progress: '%' };
  const SORT_ORDER: SortMode[] = ['name', 'date', 'progress'];

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

  let sortMode = $state<SortMode>((localStorage.getItem(LS_SORT) as SortMode) || 'name');

  function toggleSort() {
    const idx = SORT_ORDER.indexOf(sortMode);
    sortMode = SORT_ORDER[(idx + 1) % SORT_ORDER.length];
    localStorage.setItem(LS_SORT, sortMode);
  }

  function getProgress(bookId: string): number {
    try {
      const raw = localStorage.getItem(lsProgressKey(bookId));
      if (!raw) return -1;
      const p = JSON.parse(raw);
      return p.total > 1 ? p.page / p.total : 0;
    } catch { return -1; }
  }

  function sortByName<T extends { name?: string; title?: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => (a.name || a.title || '').localeCompare(b.name || b.title || ''));
  }

  function sortByDate<T extends { createdAt?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  let childFolders = $derived.by(() => {
    const filtered = folders.filter(f => (f.parent_id || null) === currentFolderId);
    return sortMode === 'date' ? sortByDate(filtered) : sortByName(filtered);
  });

  let childBooks = $derived.by(() => {
    const filtered = books.filter(b => (b.folder_id || null) === currentFolderId);
    if (sortMode === 'date') return sortByDate(filtered);
    if (sortMode === 'progress') {
      return [...filtered].sort((a, b) => {
        const pa = getProgress(a.id), pb = getProgress(b.id);
        // Unread last, then by progress ascending (least read first)
        if (pa < 0 && pb < 0) return 0;
        if (pa < 0) return 1;
        if (pb < 0) return -1;
        return pa - pb;
      });
    }
    return sortByName(filtered);
  });

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

  // Pre-compute all folder metadata once when books/folders change
  let folderMetaMap = $derived.by(() => {
    // Read all book costs once
    const costByBook = new Map<string, number>();
    for (const b of books) {
      try {
        const raw = localStorage.getItem(lsStatsKey(b.id));
        if (raw) {
          const stats = JSON.parse(raw);
          if (stats.cost > 0) costByBook.set(b.id, stats.cost);
        }
      } catch {}
    }

    // Build parent->children index
    const childMap = new Map<string, string[]>();
    for (const f of folders) {
      const pid = f.parent_id || '';
      if (!childMap.has(pid)) childMap.set(pid, []);
      childMap.get(pid)!.push(f.id);
    }

    // Collect all descendant folder IDs (recursive, using index)
    function collectIds(id: string, out: Set<string>) {
      out.add(id);
      for (const cid of childMap.get(id) || []) collectIds(cid, out);
    }

    const result = new Map<string, string>();
    for (const f of folders) {
      const ids = new Set<string>();
      collectIds(f.id, ids);
      const folderBooks = books.filter(b => b.folder_id && ids.has(b.folder_id));
      let totalCost = 0;
      for (const b of folderBooks) totalCost += costByBook.get(b.id) || 0;
      const parts: string[] = [folderBooks.length === 1 ? '1 book' : `${folderBooks.length} books`];
      if (totalCost > 0) parts.push(`$${totalCost.toFixed(3)}`);
      result.set(f.id, parts.join(' \u00B7 '));
    }
    return result;
  });

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
  <div class="library-toolbar">
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
    <button class="sort-btn" onclick={toggleSort} title="Sort mode">
      {SORT_LABELS[sortMode]}
    </button>
  </div>

  <div class="book-list">
    {#each childFolders as folder}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="m-card" onclick={(e) => handleFolderClick(folder, e)}>
        <div class="m-card-cover folder-cover">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="m-card-info">
          <span class="m-card-title" title={folder.name}>{folder.name}</span>
          <span class="m-card-meta">{folderMetaMap.get(folder.id) || '0 books'}</span>
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

  .library-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 4px 8px;
    gap: 8px;
  }

  .library-breadcrumb {
    flex: 1;
    font-size: 14px;
    color: var(--m-fg-muted);
  }

  .sort-btn {
    background: none;
    border: 1px solid var(--m-border-light);
    color: var(--m-fg-muted);
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
  }
  @media (hover: hover) {
    .sort-btn:hover {
      border-color: var(--m-accent);
      color: var(--m-accent);
    }
  }
  .breadcrumb-item.clickable { color: var(--m-link); cursor: pointer; }
  @media (hover: hover) {
    .breadcrumb-item.clickable:hover { text-decoration: underline; }
  }
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
