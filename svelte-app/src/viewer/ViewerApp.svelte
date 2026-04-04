<script lang="ts">
  import { onMount } from 'svelte';
  import ChatSidebar from '../lib/components/ChatSidebar.svelte';
  import ThemeToggle from '../lib/components/ThemeToggle.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import { settings, applyTheme, getBookPrompt, getChatPrompt } from '../lib/state/settings.svelte';
  import type { ChatState } from '../lib/state/chat.svelte';
  import type { ChatManager } from '../lib/state/chat-manager.svelte';
  import { library } from '../lib/state/library.svelte';
  import { router } from '../lib/state/router.svelte';
  import {
    setCachedSelection,
    setGetPageHistoryFn,
    setOnBookChangeFn,
    setPdfAppGetter,
    setCurrentBookIdFn,
    initPageTracking,
    disposePageTracking,
    getPageHistory,
    clearPageHistory,
  } from '../lib/core/tools';
  import { buildReadingAssistantPrompt } from '../lib/core/system-prompts';
  import { sendChatMessage } from '../lib/core/chat-send';
  import { createViewerSession } from './viewer-session';
  import {
    LS_VIEWER_CHAT_WIDTH,
    LS_CHAT_OPEN,
    LS_ZOOM,
    lsProgressKey,
  } from '../lib/core/constants';

  const PAGE_SYNC_INTERVAL_MS = 500;
  const TITLE_TRUNCATE = 30;
  const SELECTION_PREVIEW = 40;

  let {
    bookId,
    chatState,
    chatManager,
  }: {
    bookId: string;
    chatState: ChatState;
    chatManager: ChatManager;
  } = $props();

  let bookTitle = $state('');
  let currentPage = $state(0);
  let totalPages = $state(0);
  let pdfReady = $state(false);
  let chatResizing = $state(false);
  let pageBeforeJump = $state<number | null>(null);

  let pageInputValue = $state('1');
  let pageInputFocused = $state(false);
  let _lastAppliedTheme = '';
  let activeLoadToken = 0;

  // PDF viewer iframe
  let pdfIframe: HTMLIFrameElement;

  // Context bar state
  let contextText = $state('');
  let contextPct = $state(0);
  let cachedSelection = $state('');

  // Indexing status
  let indexingStatus = $state('');


  // Book prompt editor (separate from ChatSidebar's chat prompt editor)
  let bookPromptEditorOpen = $state(false);

  const viewerSession = createViewerSession({
    getPdfIframe: () => pdfIframe,
    getCurrentBookId: () => bookId,
    setCurrentBookId: (newBookId) => {
      router.switchBook(newBookId);
    },
    applyThemeToIframe,
    onPdfReady: restoreZoom,
    captureSelection,
    onBookMissing: () => { router.navigateToLibrary(); },
    onBookLoaded: (title) => {
      bookTitle = title;
      document.title = title + ' - Marginalia';
    },
    onIndexingStatus: (status) => { indexingStatus = status; },
    isLoadCurrent: (loadToken) => activeLoadToken === loadToken,
  });

  function getPdfApp(): any {
    return viewerSession.getPdfApp();
  }

  function buildViewerSystemPrompt(context: any) {
    return buildReadingAssistantPrompt(
      context,
      getBookPrompt(bookId),
      chatManager.activeChatId ? getChatPrompt(chatManager.activeChatId) : '',
    );
  }

  function updateContext() {
    const pct = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 100;
    contextPct = pct;
    const shortTitle = bookTitle.length > TITLE_TRUNCATE ? bookTitle.slice(0, TITLE_TRUNCATE - 2) + '...' : bookTitle;
    let info = `${shortTitle} -- p.${currentPage}/${totalPages}`;
    if (cachedSelection) {
      const preview = cachedSelection.length > SELECTION_PREVIEW
        ? cachedSelection.slice(0, SELECTION_PREVIEW - 2) + '...'
        : cachedSelection;
      info += ` | "${preview}"`;
    }
    contextText = info;
  }

  function goToPage(page: number) {
    const app = getPdfApp();
    if (!app) return;
    if (page >= 1 && page <= app.pagesCount) {
      if (app.pdfLinkService) {
        app.pdfLinkService.goToPage(page);
      } else {
        app.page = page;
      }
    }
  }

  function handlePrev() {
    const app = getPdfApp();
    if (app && app.page > 1) app.page--;
  }

  function handleNext() {
    const app = getPdfApp();
    if (app && app.page < app.pagesCount) app.page++;
  }

  function saveZoom() {
    const app = getPdfApp();
    if (app?.pdfViewer) {
      localStorage.setItem(LS_ZOOM, String(app.pdfViewer.currentScale));
    }
  }

  function restoreZoom() {
    const saved = localStorage.getItem(LS_ZOOM);
    if (!saved) return;
    const app = getPdfApp();
    if (app?.pdfViewer) {
      app.pdfViewer.currentScale = parseFloat(saved);
    }
  }

  function handleZoomOut() {
    getPdfApp()?.zoomOut();
    saveZoom();
  }

  function handleZoomIn() {
    getPdfApp()?.zoomIn();
    saveZoom();
  }


  function handlePageInputChange() {
    const p = parseInt(pageInputValue);
    const app = getPdfApp();
    if (app && p >= 1 && p <= app.pagesCount) {
      goToPage(p);
    } else {
      pageInputValue = String(app?.page || 1);
    }
  }

  function goBack() {
    router.navigateToLibrary();
  }

  async function handleChatSend(text: string) {
    if (!chatManager.activeChatId) return;
    await sendChatMessage(chatState, text, {
      buildSystemPrompt: buildViewerSystemPrompt,
      storageKey: chatManager.activeChatId,
      onBeforeSend: () => {
        cachedSelection = '';
        setCachedSelection('');
      },
      addToolSummary: true,
    });
  }

  function handlePageNav(page: number) {
    const app = getPdfApp();
    if (page && app) {
      pageBeforeJump = app.page;
      goToPage(page);
    }
  }

  function handleBackToPage() {
    if (pageBeforeJump) {
      goToPage(pageBeforeJump);
      pageBeforeJump = null;
    }
  }

  function openBookPromptEditor() {
    bookPromptEditorOpen = true;
  }

  function buildViewerPromptPreview() {
    const history = getPageHistory();
    const pageHistoryStr = history.length
      ? history.slice(-10).map((p: number) => `p.${p}`).join(' -> ') + ` -> p.${currentPage} (current)`
      : '';
    const totalSize = library.books.reduce((s, b) => s + (b.size || 0), 0);
    const totalPageCount = library.books.reduce((s, b) => s + (b.pages ? b.pages.length : 0), 0);
    const focusParts = [
      `Reading: "${bookTitle}" (id: ${bookId})`,
      `Page: ${currentPage} of ${totalPages}`,
      `Time: ${new Date().toLocaleString()}`,
      `Library: ${library.books.length} books, ${library.folders.length} folders, ${totalPageCount} pages`,
    ];
    const context = {
      focusContext: focusParts.join('\n'),
      pageText: '(not shown in preview)',
      selection: cachedSelection,
      pageHistory: pageHistoryStr,
      page: currentPage,
      totalPages,
      title: bookTitle,
      time: new Date().toLocaleString(),
      currentBookId: bookId,
      currentBookTitle: bookTitle,
      bookCount: library.books.length,
      folderCount: library.folders.length,
      totalSize,
      totalPageCount,
    };
    const system = buildViewerSystemPrompt(context);
    return Promise.resolve(system);
  }

  // Selection capture
  function captureSelection() {
    // Try parent document first
    let sel = window.getSelection()?.toString().trim() || '';
    // Also try iframe document (same-origin)
    if (!sel) {
      try {
        sel = pdfIframe?.contentWindow?.getSelection()?.toString().trim() || '';
      } catch {}
    }
    if (sel) {
      cachedSelection = sel;
      setCachedSelection(sel);
      updateContext();
    }
  }

  // onBookChange handler
  function handleBookChange(newBookId: string) {
    router.switchBook(newBookId);
    clearPageHistory();
    pageBeforeJump = null;
    cachedSelection = '';
    setCachedSelection('');
    pdfReady = false;
    void (async () => {
      await loadPdf(newBookId);
      initPageTracking();
    })();
  }

  async function loadPdf(targetBookId = bookId) {
    activeLoadToken += 1;
    await viewerSession.loadPdf(targetBookId);
  }

  function applyThemeToIframe() {
    try {
      const iframeDoc = pdfIframe?.contentDocument;
      if (!iframeDoc) return;
      let style = iframeDoc.getElementById('marginalia-theme-style');
      if (!style) {
        style = iframeDoc.createElement('style');
        style.id = 'marginalia-theme-style';
        iframeDoc.head.appendChild(style);
      }
      if (settings.theme === 'dark') {
        style.textContent = `
          #viewerContainer { filter: invert(0.88) hue-rotate(180deg); background: white; }
          body { background: #1d2021 !important; }
        `;
      } else {
        style.textContent = '';
      }
    } catch {}
  }


  // Sync page number from pdf.js
  let syncInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    applyTheme();

    syncInterval = setInterval(() => {
      const app = getPdfApp();
      if (!app) return;
      currentPage = app.page || 1;
      totalPages = app.pagesCount || 0;
      if (totalPages > 0) pdfReady = true;
      if (!pageInputFocused) {
        pageInputValue = String(currentPage || '');
      }
      // Save reading progress
      if (bookId && totalPages > 1) {
        localStorage.setItem(lsProgressKey(bookId), JSON.stringify({ page: currentPage, total: totalPages, lastOpen: Date.now() }));
      }
      updateContext();
      if (settings.theme !== _lastAppliedTheme) {
        applyThemeToIframe();
        _lastAppliedTheme = settings.theme;
      }
    }, PAGE_SYNC_INTERVAL_MS);

    document.addEventListener('mouseup', captureSelection);
    document.addEventListener('touchend', captureSelection);
    setGetPageHistoryFn(() => getPageHistory());
    setPdfAppGetter(() => getPdfApp());
    setCurrentBookIdFn(() => bookId);
    setOnBookChangeFn(handleBookChange);

    void (async () => {
      if (!bookId) {
        router.navigateToLibrary();
        return;
      }

      await loadPdf(bookId);
      initPageTracking();
    })();

    return () => {
      clearInterval(syncInterval);
      activeLoadToken += 1;
      viewerSession.cleanup();
      disposePageTracking();
      document.removeEventListener('mouseup', captureSelection);
      document.removeEventListener('touchend', captureSelection);
      setGetPageHistoryFn(null);
      setOnBookChangeFn(null);
      setPdfAppGetter(null);
      setCurrentBookIdFn(null);
    };
  });

</script>

<div class="viewer-app">
  <div class="m-toolbar">
    <div class="m-toolbar-left">
      <button class="m-btn m-btn-text" title="Library" onclick={goBack}>&larr; Library</button>
      <span class="m-toolbar-text" title={bookTitle}>{bookTitle}</span>
    </div>
    <div class="m-toolbar-center">
      {#if pdfReady}
        <button class="m-btn" title="Previous page" onclick={handlePrev}>&lsaquo;</button>
        <input
          type="number"
          class="m-page-input"
          bind:value={pageInputValue}
          onchange={handlePageInputChange}
          onfocus={() => pageInputFocused = true}
          onblur={() => pageInputFocused = false}
          min="1"
        />
        <span class="m-page-total">/ {totalPages}</span>
        <button class="m-btn" title="Next page" onclick={handleNext}>&rsaquo;</button>
      {:else}
        <span class="m-toolbar-text">Loading...</span>
      {/if}
    </div>
    <div class="m-toolbar-right">
      <button class="m-btn" title="Zoom out" onclick={handleZoomOut}>&minus;</button>
      <button class="m-btn" title="Zoom in" onclick={handleZoomIn}>+</button>
      <ThemeToggle />
    </div>
  </div>

  <div class="viewer-body">
    <iframe
      bind:this={pdfIframe}
      src="./pdfjs/web/viewer.html?file="
      class="pdf-iframe"
      title="PDF Viewer"
      style:pointer-events={chatResizing ? 'none' : 'auto'}
    ></iframe>

    <ChatSidebar
      {chatState}
      {chatManager}
      openStorageKey={LS_CHAT_OPEN}
      widthStorageKey={LS_VIEWER_CHAT_WIDTH}
      placeholder={chatManager.activeChatId ? 'Ask about this page...' : 'Create a chat to start'}
      defaultChatName={bookTitle || 'Chat'}
      onSend={handleChatSend}
      onBookClick={(id) => handleBookChange(id)}
      pageNavEnabled={true}
      onPageNav={handlePageNav}
      onResizeStart={() => { chatResizing = true; }}
      onResizeEnd={() => { chatResizing = false; }}
      promptEditorScopeId={chatManager.activeChatId || ''}
      promptEditorTitle="System prompt for this chat"
      buildFullPrompt={buildViewerPromptPreview}
      compactBookId={chatManager.activeChatId || bookId}
      extraMenuCallbacks={{ editBookPrompt: openBookPromptEditor }}
      hasExtraModalsOpen={bookPromptEditorOpen}
    >
      {#snippet contextBar()}
        <div class="context-bar">
          <div class="context-progress">
            <div class="context-fill" style:width="{contextPct}%"></div>
          </div>
          <span class="context-text">{contextText}</span>
        </div>
      {/snippet}
      {#snippet toolActivitySnippet()}
        {#if chatState.toolActivity.length > 0}
          <div class="tool-activity">
            {#each chatState.toolActivity as activity}
              <div>{activity}</div>
            {/each}
          </div>
        {/if}
      {/snippet}
    </ChatSidebar>
  </div>

  {#if pageBeforeJump !== null}
    <button class="page-back-btn" onclick={handleBackToPage}>
      &larr; Back to p.{pageBeforeJump}
    </button>
  {/if}

  {#if indexingStatus}
    <div class="indexing-status">{indexingStatus}</div>
  {/if}
</div>

<PromptEditor
  open={bookPromptEditorOpen}
  scope="book"
  scopeId={bookId}
  title="System prompt for this book"
  buildFullPrompt={buildViewerPromptPreview}
  onClose={() => { bookPromptEditorOpen = false; }}
/>

<style>
  .viewer-app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .pdf-iframe {
    flex: 1;
    border: none;
    width: 100%;
    min-width: 0;
  }

  .viewer-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .context-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--m-bg-1);
    color: var(--m-fg-muted);
    font-size: 12px;
    border-bottom: 1px solid var(--m-border);
    flex-shrink: 0;
  }

  .context-progress {
    flex-shrink: 0;
    width: 60px;
    height: 4px;
    background: var(--m-border);
    border-radius: 2px;
    overflow: hidden;
  }

  .context-fill {
    height: 100%;
    background: var(--m-accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .page-back-btn {
    position: fixed;
    bottom: 20px;
    left: 20px;
    background: var(--m-bg-1);
    color: var(--m-fg-muted);
    border: 1px solid var(--m-border-light);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    z-index: 99999;
    box-shadow: 0 2px 8px var(--m-shadow);
    transition: opacity 0.2s;
  }
  .page-back-btn:hover { border-color: var(--m-accent); color: var(--m-accent); }

  .indexing-status {
    position: fixed;
    bottom: 12px;
    left: 12px;
    background: var(--m-bg-1);
    color: var(--m-accent);
    border: 1px solid var(--m-accent);
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 12px;
    z-index: 99999;
    font-family: -apple-system, sans-serif;
    transition: opacity 0.3s;
  }

</style>
