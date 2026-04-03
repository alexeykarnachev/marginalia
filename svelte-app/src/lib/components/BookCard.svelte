<script module lang="ts">
  const coverCache = new Map<string, string>();
  const COVER_PREFIX = 'mcover_';

  // Sequential queue — only one PDF open at a time to avoid memory spikes on iPad
  let renderQueue: Promise<void> = Promise.resolve();
  function coverRenderQueue(): Promise<() => void> {
    let release: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const ticket = renderQueue;
    renderQueue = renderQueue.then(() => gate);
    return ticket.then(() => release!);
  }

  function getCachedCover(id: string): string | null {
    const mem = coverCache.get(id);
    if (mem) return mem;
    const stored = sessionStorage.getItem(COVER_PREFIX + id);
    if (stored) { coverCache.set(id, stored); return stored; }
    return null;
  }

  function setCachedCover(id: string, dataUrl: string) {
    coverCache.set(id, dataUrl);
    try { sessionStorage.setItem(COVER_PREFIX + id, dataUrl); } catch {}
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Book } from '../types';
  import { lsStatsKey, lsProgressKey } from '../core/constants';
  import { getBook } from '../core/db';
  import { log } from '../core/logger';
  import { getPdfjsLib } from '../core/pdfjs-loader';

  const COVER_RENDER_WIDTH = 300;
  const COVER_JPEG_QUALITY = 0.8;

  let {
    book,
    onOpen,
    onRename,
    onDelete,
    onMove,
    onArchive,
  }: {
    book: Book;
    onOpen: (book: Book) => void;
    onRename: (book: Book) => void;
    onDelete: (book: Book) => void;
    onMove: (book: Book) => void;
    onArchive: (book: Book) => void;
  } = $props();

  let cardEl: HTMLDivElement;
  let coverUrl = $state<string | null>(null);
  let visible = $state(false);

  let sizeMB = $derived((book.size / 1048576).toFixed(1));
  let pageCount = $derived(
    book.pages ? book.pages.length + 'p' : (book.pages === null ? '...' : '')
  );

  // Read cost and progress once at mount
  let bookCost = $state('');
  let progressPct = $state(-1); // -1 = never opened
  let meta = $derived([pageCount, sizeMB + ' MB', bookCost].filter(Boolean).join(' \u00B7 '));

  function loadMeta() {
    try {
      const raw = localStorage.getItem(lsStatsKey(book.id));
      if (raw) {
        const stats = JSON.parse(raw);
        if (stats.cost > 0) bookCost = `$${stats.cost.toFixed(3)}`;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(lsProgressKey(book.id));
      if (raw) {
        const p = JSON.parse(raw);
        if (p.total > 1) progressPct = Math.round((p.page / p.total) * 100);
      }
    } catch {}
  }

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

  function handleArchive(e: MouseEvent) {
    e.stopPropagation();
    onArchive(book);
  }

  onMount(() => {
    log('CARD', 'mount', book.id, book.title);
    loadMeta();

    // Check cache first (memory + sessionStorage)
    const cached = getCachedCover(book.id);
    if (cached) {
      coverUrl = cached;
      visible = true;
      return;
    }

    // Lazy render: only when card scrolls into view
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          visible = true;
          observer.disconnect();
          renderCover();
        }
      },
      { rootMargin: '200px' }, // start loading 200px before visible
    );
    observer.observe(cardEl);

    return () => observer.disconnect();
  });

  async function renderCover(attempt = 0) {
    const MAX_RETRIES = 2;
    const RETRY_DELAYS = [500, 2000];

    log('COVER', 'start', book.id, book.title, attempt > 0 ? `retry ${attempt}` : '');
    const release = await coverRenderQueue();
    log('COVER', 'queue released', book.id);

    try {
      const pdfjsLib = await getPdfjsLib();
      if (!pdfjsLib) { release(); return; }

      const fullBook = await getBook(book.id);
      if (!fullBook?.data) { release(); return; }

      const blob = fullBook.data instanceof Blob ? fullBook.data : new Blob([fullBook.data], { type: 'application/pdf' });
      const buf = await blob.arrayBuffer();
      if (buf.byteLength < 100) { release(); return; }
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(buf),
        standardFontDataUrl: './pdfjs/web/standard_fonts/',
      }).promise;

      try {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        const scale = COVER_RENDER_WIDTH / viewport.width;
        canvas.width = Math.round(viewport.width * scale);
        canvas.height = Math.round(viewport.height * scale);

        await page.render({
          canvasContext: canvas.getContext('2d')!,
          viewport: page.getViewport({ scale }),
        }).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY);
        log('COVER', 'rendered', book.id, 'dataUrl length:', dataUrl.length);
        if (dataUrl.length > 100) {
          coverUrl = dataUrl;
          setCachedCover(book.id, dataUrl);
        } else {
          log('COVER', 'empty render, skipping', book.id);
        }
      } finally {
        log('COVER', 'destroying pdf', book.id);
        await pdf.destroy();
        log('COVER', 'destroyed', book.id);
      }
    } catch (err) {
      log('COVER', 'FAILED', book.id, err);
      release();
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        return renderCover(attempt + 1);
      }
      console.warn('Cover render failed permanently for', book.title, err);
      return;
    }
    release();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="m-card" class:archived={book.archived} bind:this={cardEl} onclick={handleCardClick}>
  <div class="m-card-cover">
    {#if coverUrl}
      <img src={coverUrl} alt={book.title} style="width:100%;height:100%;object-fit:cover;" />
    {:else}
      <span class="cover-placeholder">&#x1F4C4;</span>
    {/if}
  </div>
  {#if progressPct >= 0}
    <div class="progress-bar">
      <div class="progress-fill" style:width="{progressPct}%"></div>
    </div>
  {/if}
  <div class="m-card-info">
    <span class="m-card-title" title={book.title}>{book.title}</span>
    <span class="m-card-meta">{meta}</span>
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
      <button class="item-btn" title={book.archived ? 'Show' : 'Hide'} onclick={handleArchive}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          {#if book.archived}
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          {:else}
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          {/if}
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
  .archived {
    opacity: 0.5;
  }
  .cover-placeholder {
    font-size: 32px;
    color: var(--m-fg-dim);
  }
  .progress-bar {
    height: 3px;
    background: var(--m-bg-2);
    width: 100%;
  }
  .progress-fill {
    height: 100%;
    background: var(--m-accent);
    transition: width 0.3s;
  }
</style>
