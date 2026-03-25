<script lang="ts">
  import { onMount } from 'svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import ThemeToggle from '../lib/components/ThemeToggle.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import CompactEditor from '../lib/components/CompactEditor.svelte';
  import { settings, applyTheme, getBookPrompt, getChatPrompt, chatDisplay } from '../lib/state/settings.svelte';
  import { createChatState } from '../lib/state/chat.svelte';
  import { createChatManager } from '../lib/state/chat-manager.svelte';
  import { getBook, saveBook, getAllBooks } from '../lib/core/db';
  import {
    buildLibraryContext,
    setCachedSelection,
    setGetPageHistoryFn,
    setOnBookChangeFn,
    setPdfAppGetter,
    initPageTracking,
    disposePageTracking,
    getPageHistory,
    clearPageHistory,
  } from '../lib/core/tools';
  import {
    SYSTEM_PROMPT,
    BOOK_PROMPT_HEADER,
    CHAT_PROMPT_HEADER,
    SUMMARY_HEADER,
    renderPrompt,
  } from '../lib/core/prompt';
  import { sendChatMessage } from '../lib/core/chat-send';
  import {
    DEFAULT_CHAT_WIDTH,
    LS_VIEWER_CHAT_WIDTH,
    LS_CHAT_OPEN,
    SS_BOOK_ID,
  } from '../lib/core/constants';

  const PDF_INIT_POLL_MS = 100;
  const PDF_INIT_TIMEOUT_MS = 15000;
  const PAGE_SYNC_INTERVAL_MS = 500;
  const PDF_DOC_POLL_MS = 500;
  const PDF_DOC_TIMEOUT_MS = 30000;
  const INDEXING_STATUS_CLEAR_MS = 2000;
  const INDEXING_FAIL_CLEAR_MS = 3000;
  const INDEXING_PROGRESS_INTERVAL = 10;
  const TITLE_TRUNCATE = 30;
  const SELECTION_PREVIEW = 40;

  let bookTitle = $state('');
  let currentPage = $state(1);
  let totalPages = $state(1);
  let chatOpen = $state(false);
  let pageBeforeJump = $state<number | null>(null);

  let pageInputValue = $state('1');
  let pageInputFocused = $state(false);
  let chatResizing = $state(false);
  let chatWidth = $state(parseInt(localStorage.getItem(LS_VIEWER_CHAT_WIDTH) || String(DEFAULT_CHAT_WIDTH)));
  let _lastAppliedTheme = '';
  let activePdfUrl: string | null = null;
  let activeIframeDoc: Document | null = null;
  let activePdfApp: any = null;
  let documentInitHandler: (() => void) | null = null;
  let pdfLoadToken = 0;

  // Current book ID
  let bookId = $state('');

  const chatState = createChatState();
  const chatManager = createChatManager(chatState);

  // PDF viewer iframe
  let pdfIframe: HTMLIFrameElement;

  function getPdfApp(): any {
    const iframeWindow = pdfIframe?.contentWindow as (Window & { PDFViewerApplication?: any }) | null;
    return iframeWindow?.PDFViewerApplication;
  }

  function getBookId(): string {
    return sessionStorage.getItem(SS_BOOK_ID) || '';
  }

  // Context bar state
  let contextText = $state('');
  let contextPct = $state(0);
  let cachedSelection = $state('');

  // Indexing status
  let indexingStatus = $state('');

  // All books (for book title links in chat)
  let allBooks = $state<{ id: string; title: string }[]>([]);

  // Modal states
  let promptEditorMode = $state<'book' | 'chat' | null>(null);
  let toolsEditorOpen = $state(false);
  let compactEditorOpen = $state(false);

  function buildViewerSystemPrompt(context: any) {
    let system = renderPrompt(SYSTEM_PROMPT, context as unknown as Record<string, string>);
    const bookPrompt = getBookPrompt(bookId);
    const chatPrompt = chatManager.activeChatId ? getChatPrompt(chatManager.activeChatId) : '';
    if (bookPrompt) system += '\n\n' + BOOK_PROMPT_HEADER + '\n' + bookPrompt;
    if (chatPrompt) system += '\n\n' + CHAT_PROMPT_HEADER + '\n' + chatPrompt;
    return system;
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

  function handleZoomOut() {
    getPdfApp()?.zoomOut();
  }

  function handleZoomIn() {
    getPdfApp()?.zoomIn();
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
    window.location.href = './';
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

  async function handleCompact() {
    if (!chatManager.activeChatId) return;
    await chatState.compact(settings.apiKey, settings.model, chatManager.activeChatId);
    chatState.saveToStorage(chatManager.activeChatId);
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

  async function buildViewerPromptPreview() {
    const context = await buildLibraryContext();
    let system = buildViewerSystemPrompt(context);
    if (chatState.summary) {
      system += '\n\n' + SUMMARY_HEADER + '\n' + chatState.summary;
    }
    return system;
  }

  function openCompactEditor() {
    compactEditorOpen = true;
  }

  // Book indexing
  async function indexBookInBackground(bid: string, loadToken: number) {
    const app = getPdfApp();
    if (!app?.pdfDocument) {
      indexingStatus = 'Waiting for PDF...';
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (app?.pdfDocument) { clearInterval(check); resolve(); }
        }, PDF_DOC_POLL_MS);
        setTimeout(() => { clearInterval(check); resolve(); }, PDF_DOC_TIMEOUT_MS);
      });
    }
    if (!app?.pdfDocument || loadToken !== pdfLoadToken) { indexingStatus = ''; return; }

    try {
      const pdfDocument = app.pdfDocument;
      const total = pdfDocument.numPages || app.pagesCount;
      const pages: string[] = [];
      for (let i = 1; i <= total; i++) {
        if (loadToken !== pdfLoadToken || getBookId() !== bid) {
          indexingStatus = '';
          return;
        }
        if (i === 1 || i % INDEXING_PROGRESS_INTERVAL === 0) {
          indexingStatus = `Indexing ${i}/${total}...`;
        }
        const page = await pdfDocument.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: any) => item.str).join(' '));
      }
      if (loadToken !== pdfLoadToken || getBookId() !== bid) {
        indexingStatus = '';
        return;
      }
      const book = await getBook(bid);
      if (book) {
        book.pages = pages;
        await saveBook(book);
      }
      indexingStatus = `Indexed ${total} pages`;
      setTimeout(() => { indexingStatus = ''; }, INDEXING_STATUS_CLEAR_MS);
    } catch (err: any) {
      console.warn('Indexing failed:', err);
      indexingStatus = 'Indexing failed';
      setTimeout(() => { indexingStatus = ''; }, INDEXING_FAIL_CLEAR_MS);
    }
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
    bookId = newBookId;
    sessionStorage.setItem(SS_BOOK_ID, newBookId);
    clearPageHistory();
    pageBeforeJump = null;
    cachedSelection = '';
    setCachedSelection('');
    void (async () => {
      await loadPdf(newBookId);
      initPageTracking();
    })();
  }

  function cleanupPdfSession() {
    if (activeIframeDoc) {
      activeIframeDoc.removeEventListener('mouseup', captureSelection);
      activeIframeDoc.removeEventListener('touchend', captureSelection);
      activeIframeDoc = null;
    }

    if (activePdfApp && documentInitHandler) {
      activePdfApp.eventBus?.off?.('documentinit', documentInitHandler);
    }
    activePdfApp = null;
    documentInitHandler = null;

    if (activePdfUrl) {
      URL.revokeObjectURL(activePdfUrl);
      activePdfUrl = null;
    }
  }

  async function loadPdf(targetBookId = getBookId()) {
    const loadToken = ++pdfLoadToken;
    cleanupPdfSession();

    const bid = targetBookId;
    const book = await getBook(bid);
    if (!book) {
      window.location.href = './';
      return;
    }

    bookTitle = book.title;
    document.title = book.title + ' - Marginalia';

    // Wait for iframe to load and pdf.js to initialize
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const app = getPdfApp();
        if (app?.initializedPromise) {
          clearInterval(check);
          resolve();
        }
      }, PDF_INIT_POLL_MS);
      setTimeout(() => { clearInterval(check); resolve(); }, PDF_INIT_TIMEOUT_MS);
    });

    const app = getPdfApp();
    if (!app) return;

    const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    if (loadToken !== pdfLoadToken) {
      URL.revokeObjectURL(url);
      return;
    }

    await app.initializedPromise;
    if (loadToken !== pdfLoadToken) {
      URL.revokeObjectURL(url);
      return;
    }

    if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    documentInitHandler = () => {
      if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    };
    app.eventBus?.on('documentinit', documentInitHandler);

    activePdfUrl = url;
    activePdfApp = app;
    app.open({ url });

    // Listen for selection in iframe
    try {
      const iframeDoc = pdfIframe?.contentDocument;
      if (iframeDoc) {
        iframeDoc.addEventListener('mouseup', captureSelection);
        iframeDoc.addEventListener('touchend', captureSelection);
        activeIframeDoc = iframeDoc;
      }
    } catch {}

    // Inject dark mode CSS into iframe
    applyThemeToIframe();

    // Index book on first open
    if (!book.pages) {
      indexBookInBackground(bid, loadToken);
    }
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
          .pdfViewer .page { filter: invert(0.88) hue-rotate(180deg); }
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
      totalPages = app.pagesCount || 1;
      if (!pageInputFocused) {
        pageInputValue = String(currentPage);
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
    setOnBookChangeFn(handleBookChange);

    void (async () => {
      bookId = getBookId();
      if (!bookId) {
        window.location.href = './';
        return;
      }

      const allBooksData = await getAllBooks();
      allBooks = allBooksData.map(b => ({ id: b.id, title: b.title }));
      chatManager.init(allBooks);

      await loadPdf(bookId);
      initPageTracking();
    })();

    return () => {
      pdfLoadToken++;
      clearInterval(syncInterval);
      cleanupPdfSession();
      disposePageTracking();
      document.removeEventListener('mouseup', captureSelection);
      document.removeEventListener('touchend', captureSelection);
      setGetPageHistoryFn(null);
      setOnBookChangeFn(null);
      setPdfAppGetter(null);
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
        books={allBooks}
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
        menuItems={[
          { label: 'Edit book prompt', onClick: openBookPromptEditor },
          { label: 'Edit chat prompt', onClick: openChatPromptEditor },
          { label: 'Configure tools', onClick: () => { toolsEditorOpen = true; } },
          { label: 'Compact', onClick: openCompactEditor },
        ]}
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
  onCompact={handleCompact}
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
