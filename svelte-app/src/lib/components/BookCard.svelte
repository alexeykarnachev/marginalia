<script lang="ts">
  import { onMount } from 'svelte';
  import type { Book } from '../types';

  // Module-level cover cache: avoids re-rendering covers on re-mount
  const coverCache = new Map<string, string>();

  let {
    book,
    onOpen,
    onRename,
    onDelete,
    onMove,
  }: {
    book: Book;
    onOpen: (book: Book) => void;
    onRename: (book: Book) => void;
    onDelete: (book: Book) => void;
    onMove: (book: Book) => void;
  } = $props();

  let coverEl: HTMLDivElement;
  let coverUrl = $state<string | null>(null);

  let sizeMB = $derived((book.size / 1048576).toFixed(1));
  let pageCount = $derived(
    book.pages ? book.pages.length + 'p' : (book.pages === null ? '...' : '')
  );
  let meta = $derived([pageCount, sizeMB + ' MB'].filter(Boolean).join(' \u00B7 '));

  function handleCardClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.item-actions')) return;
    onOpen(book);
  }

  function handleMove(e: MouseEvent) {
    e.stopPropagation();
    onMove(book);
  }

  function handleRename(e: MouseEvent) {
    e.stopPropagation();
    onRename(book);
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    onDelete(book);
  }

  onMount(() => {
    // Check cache first
    const cached = coverCache.get(book.id);
    if (cached) {
      coverUrl = cached;
    } else {
      renderCover();
    }
  });

  async function renderCover() {
    if (typeof globalThis.pdfjsLib === 'undefined') {
      let attempts = 0;
      while (typeof globalThis.pdfjsLib === 'undefined' && attempts < 50) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }
    }
    if (typeof globalThis.pdfjsLib === 'undefined') return;

    const pdfjsLib = (globalThis as any).pdfjsLib;
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/build/pdf.worker.mjs';
    }

    try {
      const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
      const buf = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      const scale = 300 / viewport.width;
      canvas.width = Math.round(viewport.width * scale);
      canvas.height = Math.round(viewport.height * scale);

      await page.render({
        canvasContext: canvas.getContext('2d')!,
        viewport: page.getViewport({ scale }),
      }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      coverUrl = dataUrl;
      coverCache.set(book.id, dataUrl);
    } catch (err) {
      console.warn('Cover render failed for', book.title, err);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="book-item" onclick={handleCardClick}>
  <div class="book-cover" bind:this={coverEl}>
    {#if coverUrl}
      <img src={coverUrl} alt={book.title} style="width:100%;height:100%;object-fit:cover;" />
    {:else}
      <span class="book-cover-placeholder">&#x1F4C4;</span>
    {/if}
  </div>
  <div class="book-info">
    <span class="book-title" title={book.title}>{book.title}</span>
    <span class="book-meta">{meta}</span>
    <div class="item-actions">
      <button class="item-btn" title="Move" onclick={handleMove}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="item-btn" title="Rename" onclick={handleRename}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
      </button>
      <button class="item-btn item-btn-danger" title="Delete" onclick={handleDelete}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .book-item {
    background: var(--m-bg-1);
    border: 1px solid var(--m-border);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .book-item:hover { box-shadow: 0 2px 12px var(--m-shadow); }

  .book-cover {
    width: 100%;
    aspect-ratio: 3 / 4;
    background: var(--m-bg-2);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }
  .book-cover-placeholder {
    font-size: 32px;
    color: var(--m-fg-dim);
  }

  .book-info {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .book-title {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.3;
  }
  .book-meta {
    font-size: 11px;
    color: var(--m-fg-dim);
  }

  .item-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .book-item:hover .item-actions { opacity: 1; }
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
</style>
