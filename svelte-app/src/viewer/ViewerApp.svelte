<script lang="ts">
  import { onMount } from 'svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import ThemeToggle from '../lib/components/ThemeToggle.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import CompactEditor from '../lib/components/CompactEditor.svelte';
  import { settings, applyTheme, getBookPrompt, getChatPrompt, chatDisplay } from '../lib/state/settings.svelte';
  import type { ChatState } from '../lib/state/chat.svelte';
  import type { ChatManager } from '../lib/state/chat-manager.svelte';
  import { library } from '../lib/state/library.svelte';
  import { router } from '../lib/state/router.svelte';
  import { buildChatMenuItems } from '../lib/core/chat-menu';
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
  import { SUMMARY_HEADER } from '../lib/core/prompt';
  import { buildReadingAssistantPrompt } from '../lib/core/system-prompts';
  import { sendChatMessage } from '../lib/core/chat-send';
  import { createViewerSession } from './viewer-session';
  import {
    DEFAULT_CHAT_WIDTH,
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
  let chatOpen = $state(false);
  let pageBeforeJump = $state<number | null>(null);

  let pageInputValue = $state('1');
  let pageInputFocused = $state(false);
  let chatResizing = $state(false);
  let chatWidth = $state(parseInt(localStorage.getItem(LS_VIEWER_CHAT_WIDTH) || String(DEFAULT_CHAT_WIDTH)));
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


  // Modal states
  let promptEditorMode = $state<'book' | 'chat' | null>(null);
  let toolsEditorOpen = $state(false);
  let compactEditorOpen = $state(false);

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

  function toggleChat() {
    if (!chatOpen && !settings.apiKey) {
      alert('Please set your OpenRouter API key in Settings (on the library page).');
      return;
    }
    chatOpen = !chatOpen;
    localStorage.setItem(LS_CHAT_OPEN, chatOpen ? '1' : '0');
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

  function handleChatClear() {
    if (chatState.messages.length === 0) return;
    if (!confirm('Clear chat history?')) return;
    chatState.clearMessages();
    chatState.setSummary(null);
    chatState.resetStats();
    if (chatManager.activeChatId) chatState.saveToStorage(chatManager.activeChatId);
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
    promptEditorMode = 'book';
  }

  function openChatPromptEditor() {
    if (!chatManager.activeChatId) {
      alert('Create a chat first.');
      return;
    }
    promptEditorMode = 'chat';
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
      libraryTree: library.libraryTree,
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
    let system = buildViewerSystemPrompt(context);
    if (chatState.summary) {
      system += '\n\n' + SUMMARY_HEADER + '\n' + chatState.summary;
    }
    return Promise.resolve(system);
  }

  function openCompactEditor() {
    compactEditorOpen = true;
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Modals handle their own Escape via Modal.svelte
      if (chatOpen && !compactEditorOpen && !promptEditorMode && !toolsEditorOpen) {
        chatOpen = false;
        localStorage.setItem(LS_CHAT_OPEN, '0');
      }
    }
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

    if (localStorage.getItem(LS_CHAT_OPEN) === '1' && settings.apiKey) {
      chatOpen = true;
    }

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

<svelte:window onkeydown={handleKeydown} />

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

    {#if chatOpen}
      <ChatPanel
        placeholder={chatManager.activeChatId ? 'Ask about this page...' : 'Create a chat to start'}
        messages={chatState.messages}
        sending={chatState.sending}
        onSend={handleChatSend}
        onClear={handleChatClear}
        onClose={toggleChat}
        pageNavEnabled={true}
        onPageNav={handlePageNav}
        fontSize={chatDisplay.fontSize}
        mono={chatDisplay.mono}
        books={library.books.map(b => ({ id: b.id, title: b.title }))}
        onBookClick={(id) => handleBookChange(id)}
        width={chatWidth}
        onResizeStart={() => chatResizing = true}
        onResizeEnd={(w) => {
          chatResizing = false;
          chatWidth = w;
          localStorage.setItem(LS_VIEWER_CHAT_WIDTH, String(w));
        }}
        onFontSizeChange={(s) => { chatDisplay.fontSize = s; }}
        onMonoToggle={() => chatDisplay.toggleMono()}
        stats={chatState.stats}
        chats={chatManager.chats}
        activeChatId={chatManager.activeChatId}
        onSelectChat={chatManager.select}
        onCreateChat={() => chatManager.create(bookTitle || 'Chat')}
        onRenameChat={chatManager.rename}
        onDeleteChat={chatManager.remove}
        onTruncate={chatManager.truncate}
        menuItems={buildChatMenuItems({
          editBookPrompt: openBookPromptEditor,
          editChatPrompt: openChatPromptEditor,
          configureTools: () => { toolsEditorOpen = true; },
          compact: openCompactEditor,
        })}
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
      </ChatPanel>
    {/if}
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
  open={promptEditorMode !== null}
  scope={promptEditorMode || 'book'}
  scopeId={promptEditorMode === 'chat' ? (chatManager.activeChatId || '') : bookId}
  title={promptEditorMode === 'chat' ? 'System prompt for this chat' : 'System prompt for this book'}
  buildFullPrompt={buildViewerPromptPreview}
  onClose={() => { promptEditorMode = null; }}
/>

<ToolsEditor
  open={toolsEditorOpen}
  onClose={() => { toolsEditorOpen = false; }}
/>

<CompactEditor
  open={compactEditorOpen}
  bookId={chatManager.activeChatId || bookId}
  onClose={() => { compactEditorOpen = false; }}
  onCompact={() => chatManager.compact(settings.apiKey, settings.model)}
/>

{#if !chatOpen}
  <button class="m-chat-fab" title="Chat" onclick={toggleChat}>💬</button>
{/if}

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
