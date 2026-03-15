<script lang="ts">
  import { onMount } from 'svelte';
  import Toolbar from '../lib/components/Toolbar.svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import ThemeToggle from '../lib/components/ThemeToggle.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import { settings, applyTheme, getBookPrompt } from '../lib/state/settings.svelte';
  import { createChatState } from '../lib/state/chat.svelte';
  import { getBook, saveBook, getAllBooks, MARGINALIA_VERSION } from '../lib/core/db';
  import {
    buildLibraryContext,
    setCachedSelection,
    setGetPageHistoryFn,
    setOnBookChangeFn,
    setPdfAppGetter,
    initPageTracking,
    getPageHistory,
    clearPageHistory,
  } from '../lib/core/tools';
  import { agentLoop } from '../lib/core/agent';
  import {
    SYSTEM_PROMPT,
    renderPrompt,
    buildApiMessages,
    compactMessages,
  } from '../lib/core/prompt';
  import type { ChatMessage } from '../lib/types';

  let bookTitle = $state('');
  let currentPage = $state(1);
  let totalPages = $state(1);
  let chatOpen = $state(false);
  let pageBeforeJump = $state<number | null>(null);

  let pageInputValue = $state('1');
  let pageInputFocused = $state(false);
  let chatResizing = $state(false);
  let chatWidth = $state(parseInt(localStorage.getItem('marginalia_viewer_chat_width') || '380'));
  let _lastAppliedTheme = '';

  // Current book ID
  let bookId = $state('');

  const chatState = createChatState();

  // PDF viewer iframe
  let pdfIframe: HTMLIFrameElement;

  function getPdfApp(): any {
    return pdfIframe?.contentWindow?.PDFViewerApplication;
  }

  function getBookId(): string {
    return sessionStorage.getItem('marginalia_book_id') || '';
  }

  // Context bar state
  let contextText = $state('');
  let contextPct = $state(0);
  let cachedSelection = $state('');

  // Tool activity state
  let toolActivity = $state<string[]>([]);

  // Indexing status
  let indexingStatus = $state('');

  // All books (for book title links in chat)
  let allBooks = $state<{ id: string; title: string }[]>([]);

  // Modal states
  let promptEditorOpen = $state(false);
  let toolsEditorOpen = $state(false);

  // Font size and mono toggle
  let chatFontSize = $state(parseInt(localStorage.getItem('marginalia_chat_font') || '14'));
  let chatMono = $state(localStorage.getItem('marginalia_chat_mono') === '1');

  function setFontSize(size: number) {
    chatFontSize = size;
    localStorage.setItem('marginalia_chat_font', String(size));
  }

  function toggleMono() {
    chatMono = !chatMono;
    localStorage.setItem('marginalia_chat_mono', chatMono ? '1' : '0');
  }

  function updateContext() {
    const pct = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 100;
    contextPct = pct;
    const shortTitle = bookTitle.length > 30 ? bookTitle.slice(0, 28) + '...' : bookTitle;
    let info = `${shortTitle} -- p.${currentPage}/${totalPages}`;
    if (cachedSelection) {
      const preview = cachedSelection.length > 40
        ? cachedSelection.slice(0, 38) + '...'
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
    window.location.href = '/';
  }

  function toggleChat() {
    if (!chatOpen && !settings.apiKey) {
      alert('Please set your OpenRouter API key in Settings (on the library page).');
      return;
    }
    chatOpen = !chatOpen;
    localStorage.setItem('marginalia_chat_open', chatOpen ? '1' : '0');
  }

  // Humanize tool action names for display
  function humanizeToolAction(name: string, args: any): string {
    switch (name) {
      case 'read_page': return `Reading page ${args.page}...`;
      case 'read_pages': return `Reading pages ${args.from}-${args.to}...`;
      case 'search_book': return `Searching for "${args.query}"...`;
      case 'search_all_books': return `Searching all books for "${args.query}"...`;
      case 'go_to_page': return `Going to page ${args.page}...`;
      case 'go_back': return 'Going back...';
      case 'open_book': return 'Opening book...';
      case 'get_table_of_contents': return 'Getting table of contents...';
      case 'rename_book': return `Renaming to "${args.new_title}"...`;
      case 'move_book': return 'Moving book...';
      case 'delete_book': return 'Deleting book...';
      case 'create_folder': return `Creating folder "${args.name}"...`;
      case 'rename_folder': return `Renaming folder to "${args.new_name}"...`;
      case 'delete_folder': return 'Deleting folder...';
      case 'move_folder': return 'Moving folder...';
      case 'batch_move_books': return `Moving ${args.book_ids?.length || '?'} books...`;
      case 'batch_rename_books': return `Renaming ${args.renames?.length || '?'} books...`;
      default: return `${name}...`;
    }
  }

  async function handleChatSend(text: string) {
    if (!settings.apiKey) {
      alert('Set your OpenRouter API key in Settings first.');
      return;
    }
    chatState.addMessage({ role: 'user', content: text });
    chatState.setSending(true);
    toolActivity = [];

    try {
      const context = await buildLibraryContext();
      // Clear cached selection after consuming it
      cachedSelection = '';
      setCachedSelection('');

      let system = renderPrompt(SYSTEM_PROMPT, context as unknown as Record<string, string>);
      const bp = getBookPrompt(bookId);
      if (bp) system += '\n\n## Book-specific instructions (MUST FOLLOW)\n' + bp;

      const apiMessages = buildApiMessages(system, chatState.messages, chatState.summary);

      const result = await agentLoop(settings.apiKey, settings.model, apiMessages as ChatMessage[], {
        onDelta: (_delta: string, full: string) => {
          // Clear tool activity when text starts streaming
          toolActivity = [];
          const msgs = chatState.messages;
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            chatState.updateLastMessage(full);
          } else {
            chatState.addMessage({ role: 'assistant', content: full });
          }
        },
        onToolCall: (name: string, args: any) => {
          toolActivity = [...toolActivity, humanizeToolAction(name, args)];
        },
        onToolResult: () => {},
        onThinking: () => {},
        onUsage: (usage: any, model: string) => {
          chatState.stats.inputTokens += usage.prompt_tokens || 0;
          chatState.stats.outputTokens += usage.completion_tokens || 0;
          chatState.stats.cost += usage.cost || 0;
          chatState.stats.lastContextTokens = usage.prompt_tokens || 0;
          if (model) chatState.stats.model = model;
        },
      });

      // Finalize tool activity as a system message if there were tool calls
      if (toolActivity.length > 0) {
        const summary = toolActivity.length <= 2
          ? toolActivity.join(' -> ')
          : `${toolActivity[0]} -> ... -> ${toolActivity[toolActivity.length - 1]} (${toolActivity.length} steps)`;
        chatState.addMessage({ role: 'system', content: summary });
      }
      toolActivity = [];

      const msgs = chatState.messages;
      const last = msgs[msgs.length - 1];
      if (result.content && (!last || last.role !== 'assistant')) {
        chatState.addMessage({ role: 'assistant', content: result.content });
      } else if (result.content && last?.role === 'assistant') {
        last.content = result.content;
      }
    } catch (err: any) {
      chatState.addMessage({ role: 'system', content: 'Error: ' + err.message });
    }

    chatState.setSending(false);
    toolActivity = [];

    // Save chat after turn
    if (bookId) chatState.saveToStorage(bookId);

    // Auto-compact if enabled and over threshold
    if (settings.autoCompact) {
      const convCount = chatState.messages.filter(
        (m: ChatMessage) => m.role === 'user' || m.role === 'assistant'
      ).length;
      const overTokens = chatState.stats.lastContextTokens > settings.compactThreshold;
      const overMessages = convCount > 22; // RECENT_MSG_COUNT + 10
      if ((overTokens || overMessages) && convCount > 16) { // RECENT_MSG_COUNT + 4
        handleCompact();
      }
    }
  }

  function handleChatClear() {
    if (chatState.messages.length === 0) return;
    if (!confirm('Clear chat history for this book?')) return;
    chatState.clearMessages();
    chatState.setSummary(null);
    chatState.resetStats();
    if (bookId) chatState.saveToStorage(bookId);
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
    if (!settings.apiKey) return;
    const convCount = chatState.messages.filter(
      (m: ChatMessage) => m.role === 'user' || m.role === 'assistant'
    ).length;
    if (convCount < 6) {
      chatState.addMessage({ role: 'system', content: 'Not enough messages to compact.' });
      return;
    }

    chatState.addMessage({ role: 'system', content: 'Compacting conversation...' });
    try {
      const result = await compactMessages(
        settings.apiKey,
        settings.model,
        chatState.messages,
        chatState.summary,
      );
      chatState.setMessages(result.messages);
      chatState.setSummary(result.summary);
    } catch (err: any) {
      // Remove the "Compacting..." message
      chatState.setMessages(
        chatState.messages.filter((m: ChatMessage) => m.content !== 'Compacting conversation...')
      );
      chatState.addMessage({ role: 'system', content: `Compact failed: ${err.message}` });
    }
    if (bookId) chatState.saveToStorage(bookId);
  }

  // Book indexing
  async function indexBookInBackground(bid: string) {
    const app = getPdfApp();
    if (!app?.pdfDocument) {
      indexingStatus = 'Waiting for PDF...';
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (app?.pdfDocument) { clearInterval(check); resolve(); }
        }, 500);
        setTimeout(() => { clearInterval(check); resolve(); }, 30000);
      });
    }
    if (!app?.pdfDocument) { indexingStatus = ''; return; }

    try {
      const total = app.pagesCount;
      const pages: string[] = [];
      for (let i = 1; i <= total; i++) {
        if (i === 1 || i % 10 === 0) {
          indexingStatus = `Indexing ${i}/${total}...`;
        }
        const page = await app.pdfDocument.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item: any) => item.str).join(' '));
      }
      const book = await getBook(bid);
      if (book) {
        book.pages = pages;
        await saveBook(book);
      }
      indexingStatus = `Indexed ${total} pages`;
      setTimeout(() => { indexingStatus = ''; }, 2000);
    } catch (err: any) {
      console.warn('Indexing failed:', err);
      indexingStatus = 'Indexing failed';
      setTimeout(() => { indexingStatus = ''; }, 3000);
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
    // Save current book's chat state
    if (bookId) chatState.saveToStorage(bookId);

    // Switch to new book
    bookId = newBookId;
    sessionStorage.setItem('marginalia_book_id', newBookId);

    // Load new book's chat state
    chatState.clearMessages();
    chatState.setSummary(null);
    chatState.resetStats();
    chatState.loadFromStorage(newBookId);

    // Clear page history from previous book
    clearPageHistory();

    // Reload PDF
    loadPdf();
    initPageTracking();
  }

  async function loadPdf() {
    const bid = getBookId();
    const book = await getBook(bid);
    if (!book) {
      window.location.href = '/';
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
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 15000);
    });

    const app = getPdfApp();
    if (!app) return;

    const blob = book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    await app.initializedPromise;
    if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    app.eventBus?.on('documentinit', () => {
      if (app.pdfViewer) app.pdfViewer.spreadMode = 0;
    });

    app.open({ url });

    // Listen for selection in iframe
    try {
      const iframeDoc = pdfIframe?.contentDocument;
      if (iframeDoc) {
        iframeDoc.addEventListener('mouseup', captureSelection);
        iframeDoc.addEventListener('touchend', captureSelection);
      }
    } catch {}

    // Inject dark mode CSS into iframe
    applyThemeToIframe();

    // Index book on first open
    if (!book.pages) {
      indexBookInBackground(bid);
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
      if (promptEditorOpen) { promptEditorOpen = false; return; }
      if (toolsEditorOpen) { toolsEditorOpen = false; return; }
      if (chatOpen) { chatOpen = false; localStorage.setItem('marginalia_chat_open', '0'); return; }
    }
  }

  // Sync page number from pdf.js
  let syncInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    applyTheme();

    // Load PDF
    bookId = getBookId();
    if (!bookId) {
      window.location.href = '/';
      return;
    }

    // Load persisted chat
    chatState.loadFromStorage(bookId);

    // Load book list for chat links
    getAllBooks().then(bs => { allBooks = bs.map(b => ({ id: b.id, title: b.title })); });

    // Load PDF after iframe is ready
    loadPdf();

    // Sync page display
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
    }, 500);

    // Restore chat open state
    if (localStorage.getItem('marginalia_chat_open') === '1' && settings.apiKey) {
      chatOpen = true;
    }

    // Selection capture listeners
    document.addEventListener('mouseup', captureSelection);
    document.addEventListener('touchend', captureSelection);

    // Page tracking
    initPageTracking();
    setGetPageHistoryFn(() => getPageHistory());

    // Wire PDF app access for tools
    setPdfAppGetter(() => getPdfApp());

    // Book change handler
    setOnBookChangeFn(handleBookChange);

    return () => {
      clearInterval(syncInterval);
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
      src="/pdfjs/web/viewer.html?file="
      class="pdf-iframe"
      title="PDF Viewer"
      style:pointer-events={chatResizing ? 'none' : 'auto'}
    ></iframe>

    {#if chatOpen}
      <ChatPanel
        placeholder="Ask about this page..."
        messages={chatState.messages}
        sending={chatState.sending}
        onSend={handleChatSend}
        onClear={handleChatClear}
        onClose={toggleChat}
        pageNavEnabled={true}
        onPageNav={handlePageNav}
        fontSize={chatFontSize}
        mono={chatMono}
        books={allBooks}
        onBookClick={(id) => handleBookChange(id)}
        width={chatWidth}
        onResizeStart={() => chatResizing = true}
        onResizeEnd={(w) => {
          chatResizing = false;
          localStorage.setItem('marginalia_viewer_chat_width', String(w));
        }}
        onFontSizeChange={setFontSize}
        onMonoToggle={toggleMono}
        stats={chatState.stats}
        menuItems={[
          { label: 'Edit prompt', onClick: () => { promptEditorOpen = true; } },
          { label: 'Configure tools', onClick: () => { toolsEditorOpen = true; } },
          { label: 'Compact', onClick: handleCompact },
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
          {#if toolActivity.length > 0}
            <div class="tool-activity">
              {#each toolActivity as activity}
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
  open={promptEditorOpen}
  {bookId}
  onClose={() => { promptEditorOpen = false; }}
/>

<ToolsEditor
  open={toolsEditorOpen}
  onClose={() => { toolsEditorOpen = false; }}
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

  .tool-activity {
    background: var(--m-bg-1);
    color: var(--m-fg-muted);
    font-size: 0.8em;
    font-style: italic;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--m-border);
  }
</style>
