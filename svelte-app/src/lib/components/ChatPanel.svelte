<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import katex from 'katex';
  import DOMPurify from 'dompurify';
  import type { ChatMessage } from '../types';
  import type { ChatEntry } from '../core/chat-registry';
  import {
    DEFAULT_CHAT_WIDTH,
    DEFAULT_CHAT_FONT_SIZE,
  } from '../core/constants';

  const CHAT_MIN_WIDTH = 280;
  const CHAT_MAX_WIDTH_RATIO = 0.7;
  const COPY_FEEDBACK_MS = 1500;
  const SEND_DONE_FEEDBACK_MS = 1500;
  const FONT_SIZES = [
    { label: 'S', value: 12 },
    { label: 'M', value: 14 },
    { label: 'L', value: 16 },
    { label: 'XL', value: 20 },
  ] as const;

  interface MenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
  }

  let {
    placeholder = 'Ask something...',
    messages,
    sending,
    onSend,
    onClear,
    menuItems = [],
    onClose,
    width = DEFAULT_CHAT_WIDTH,
    pageNavEnabled = false,
    onPageNav,
    contextBar,
    toolActivitySnippet,
    fontSize = DEFAULT_CHAT_FONT_SIZE,
    mono = false,
    books = [],
    onBookClick,
    onResizeStart: onResizeStartCb,
    onResizeEnd: onResizeEndCb,
    onFontSizeChange,
    onMonoToggle,
    stats,
    chats = [],
    activeChatId = null,
    onSelectChat,
    onCreateChat,
    onRenameChat,
    onDeleteChat,
    onTruncate,
  } : {
    placeholder?: string;
    messages: ChatMessage[];
    sending: boolean;
    onSend: (text: string) => void;
    onClear: () => void;
    menuItems?: MenuItem[];
    onClose: () => void;
    width?: number;
    pageNavEnabled?: boolean;
    onPageNav?: (page: number) => void;
    contextBar?: import('svelte').Snippet;
    toolActivitySnippet?: import('svelte').Snippet;
    fontSize?: number;
    mono?: boolean;
    books?: { id: string; title: string }[];
    onBookClick?: (bookId: string) => void;
    onResizeStart?: () => void;
    onResizeEnd?: (width: number) => void;
    onFontSizeChange?: (size: number) => void;
    onMonoToggle?: () => void;
    stats?: { inputTokens: number; outputTokens: number; cost: number; model: string };
    chats?: ChatEntry[];
    activeChatId?: string | null;
    onSelectChat?: (id: string) => void;
    onCreateChat?: () => void;
    onRenameChat?: (id: string) => void;
    onDeleteChat?: (id: string) => void;
    onTruncate?: (fromIndex: number) => void;
  } = $props();

  let inputText = $state('');
  let menuOpen = $state(false);
  let chatListOpen = $state(false);
  let rawMode = $state(false);
  let messagesEl: HTMLDivElement;
  let inputEl: HTMLTextAreaElement;
  let containerEl: HTMLDivElement;
  let sendDone = $state(false);

  // Resize state
  let resizing = $state(false);
  let dragWidth = $state(0);
  let currentWidth = $derived(resizing ? dragWidth : width);
  let startX = 0;
  let startW = 0;

  let userInteracted = false;

  function handleMessagesScroll() {
    // Any scroll during generation = user took control
    if (sending) userInteracted = true;
  }

  function handleMessagesTouch() {
    if (sending) userInteracted = true;
  }

  // Auto-scroll: only during active generation, and only if user hasn't touched
  $effect(() => {
    void messages.length;
    const shouldFollow = sending && !userInteracted;
    tick().then(() => {
      if (messagesEl && shouldFollow) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  });

  function handleSend() {
    const text = inputText.trim();
    if (!text || sending || !activeChatId) return;
    inputText = '';
    userInteracted = false;
    onSend(text);
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    menuOpen = false;
    onClear();
  }

  function handleMenuItemClick(item: MenuItem) {
    menuOpen = false;
    item.onClick();
  }

  function handleClickOutsideMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.menu-btn') && !target.closest('.marginalia-popover')) {
      menuOpen = false;
    }
    if (!target.closest('.chat-selector-btn') && !target.closest('.chat-list-popover')) {
      chatListOpen = false;
    }
  }

  // Resize handlers
  function onResizeStart(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    startX = clientX;
    startW = currentWidth;
    dragWidth = currentWidth;
    resizing = true;
    onResizeStartCb?.();
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      if ('preventDefault' in ev && 'touches' in ev === false) ev.preventDefault();
      dragWidth = Math.max(CHAT_MIN_WIDTH, Math.min(startW + (startX - cx), window.innerWidth * CHAT_MAX_WIDTH_RATIO));
    };

    const onEnd = () => {
      resizing = false;
      onResizeEndCb?.(dragWidth);
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);
  }

  // Render cache: avoids re-running marked+DOMPurify+KaTeX for unchanged messages
  const renderCache = new Map<string, string>();
  let bookById = $derived(new Map(books.map(b => [b.id, b])));

  function renderMarkdown(text: string): string {
    const cached = renderCache.get(text);
    if (cached) return cached;
    const blocks: string[] = [];
    const inlines: string[] = [];
    const pageLinks: string[] = [];

    let result = text;

    // Protect [p.N] page links from markdown parser
    if (pageNavEnabled) {
      result = result.replace(/\[p\.(\d+(?:[-\u2013]\d+)?)\]/g, (m) => {
        const id = `%%PAGE${pageLinks.length}%%`;
        pageLinks.push(m);
        return id;
      });
    }

    // Protect LaTeX blocks
    result = result.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_, a, b) => {
      const id = `%%BLOCK${blocks.length}%%`;
      blocks.push(a || b);
      return id;
    });
    result = result.replace(/\\\((.*?)\\\)|\$([^\s$](?:[^$]*?[^\s$])?)\$/g, (_, a, b) => {
      const id = `%%INLINE${inlines.length}%%`;
      inlines.push(a || b);
      return id;
    });

    // Parse markdown
    if (marked) {
      result = marked.parse(result) as string;
    }

    // Render KaTeX
    if (katex) {
      blocks.forEach((tex, i) => {
        try {
          result = result.replace(`%%BLOCK${i}%%`,
            katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
        } catch {}
      });
      inlines.forEach((tex, i) => {
        try {
          result = result.replace(`%%INLINE${i}%%`,
            katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }));
        } catch {}
      });
    }

    // Book links: convert [id: UUID] patterns into clickable links before stripping
    if (bookById.size > 0) {
      // Match [id: UUID] or (id: UUID) — replace with link using book title
      result = result.replace(/[\[(]id:\s*`?([0-9a-f-]{36})`?\s*[\])]/gi, (_m, id) => {
        const book = bookById.get(id);
        if (book) return `<a class="marginalia-book-link" data-book-id="${id}" href="#">${book.title}</a>`;
        return '';
      });
    }

    // Strip remaining UUIDs and IDs from display
    result = result.replace(/\bid:\s*`?[0-9a-f-]{36}`?/gi, '');
    result = result.replace(/`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`/g, '');
    result = result.replace(/,\s*\)/g, ')');
    result = result.replace(/\(\s*\)/g, '');
    result = result.replace(/\[\s*\]/g, '');

    // Restore [p.N] page links
    if (pageNavEnabled) {
      pageLinks.forEach((pl, i) => { result = result.replace(`%%PAGE${i}%%`, pl); });
      result = result.replace(/\[p\.(\d+)[-\u2013](\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1-$2</a>');
      result = result.replace(/\[p\.(\d+)\]/g, '<a class="marginalia-page-link" data-page="$1" href="#">p.$1</a>');

      const _pl = (_m: string, pre: string, n: string) =>
        `${pre}<a class="marginalia-page-link" data-page="${n}" href="#">${n}</a>`;
      result = result.replace(/\b(p\.)(\d+)\b/g, _pl);
      result = result.replace(/\b(pp?\.\s*)(\d+)\b/g, _pl);
      result = result.replace(/\b(page\s+)(\d+)\b/gi, _pl);
      result = result.replace(/\b(pages?\s+)(\d+)\b/gi, _pl);
      result = result.replace(/(стр\.\s*)(\d+)/g, _pl);
      result = result.replace(/(с\.\s+)(\d+)/g, _pl);
      result = result.replace(/(страниц[а-яё]*\s+)(\d+)/gi, _pl);
    }

    // Book title links: wrap <strong>Title</strong> matching known book titles
    if (books.length > 0) {
      for (const book of books) {
        if (!book.title) continue;
        const escaped = book.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<strong>(${escaped})</strong>`, 'g');
        result = result.replace(re, `<a class="marginalia-book-link" data-book-id="${book.id}" href="#">$1</a>`);
      }
    }

    result = DOMPurify.sanitize(result, { ADD_ATTR: ['data-page', 'data-book-id'] });
    renderCache.set(text, result);
    return result;
  }

  function handleCopyClick(e: MouseEvent) {
    const btn = (e.currentTarget as HTMLElement);
    const msg = btn.closest('.marginalia-msg');
    if (!msg) return;
    const raw = (msg as HTMLElement).dataset.raw || msg.textContent || '';
    navigator.clipboard.writeText(raw).catch(() => {});
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
    setTimeout(() => { btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, COPY_FEEDBACK_MS);
  }

  function handleMessagesClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const link = target.closest('.marginalia-page-link') as HTMLElement | null;
    if (link && pageNavEnabled && onPageNav) {
      e.preventDefault();
      const page = parseInt(link.dataset.page || '');
      if (page) onPageNav(page);
    }
    const bookLink = target.closest('.marginalia-book-link') as HTMLElement | null;
    if (bookLink && onBookClick) {
      e.preventDefault();
      const bookId = bookLink.dataset.bookId || '';
      if (bookId) onBookClick(bookId);
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutsideMenu);
    return () => {
      document.removeEventListener('click', handleClickOutsideMenu);
    };
  });

  // Show checkmark after send completes
  let prevSending = $state(false);
  $effect(() => {
    if (prevSending && !sending) {
      sendDone = true;
      setTimeout(() => { sendDone = false; }, SEND_DONE_FEEDBACK_MS);
    }
    prevSending = sending;
  });
</script>

<div
  class="chat-panel"
  bind:this={containerEl}
  style:width="{currentWidth}px"
  class:resizing
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="chat-resize-handle"
    onmousedown={onResizeStart}
    ontouchstart={onResizeStart}
  ></div>

  <div class="m-chat-header">
    {#if onSelectChat}
      <button
        class="chat-selector-btn"
        onclick={(e) => { e.stopPropagation(); chatListOpen = !chatListOpen; }}
        title="Switch chat"
      >
        <span class="chat-selector-name">{chats.find(c => c.id === activeChatId)?.name || 'New chat...'}</span>
        <span class="chat-selector-arrow">{chatListOpen ? '\u25B4' : '\u25BE'}</span>
      </button>
    {:else}
      <span>Chat</span>
    {/if}
    <div class="m-chat-header-right">
      <button
        class="m-chat-header-btn menu-btn"
        title="More"
        onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}
      >&#x22EF;</button>
      <button
        class="m-chat-header-btn"
        title="Close"
        onclick={onClose}
      >&#x2715;</button>
    </div>
  </div>

  {#if chatListOpen}
    <div class="chat-list-popover">
      {#each chats as chat}
        <div class="chat-list-item" class:active={chat.id === activeChatId}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="chat-list-name" onclick={() => { onSelectChat?.(chat.id); chatListOpen = false; }}>{chat.name}</span>
          <div class="chat-list-actions">
            <button class="chat-list-action" title="Rename" onclick={(e) => { e.stopPropagation(); onRenameChat?.(chat.id); }}>&#x270F;</button>
            <button class="chat-list-action chat-list-action-danger" title="Delete" onclick={(e) => { e.stopPropagation(); onDeleteChat?.(chat.id); }}>&#x2715;</button>
          </div>
        </div>
      {/each}
      <hr class="popover-divider" />
      <button class="menu-item" onclick={() => { onCreateChat?.(); chatListOpen = false; }}>+ New chat</button>
    </div>
  {/if}

  {#if menuOpen}
    <div class="marginalia-popover">
      {#each menuItems as item}
        <button
          class="menu-item"
          class:menu-item-danger={item.danger}
          onclick={() => handleMenuItemClick(item)}
        >{item.label}</button>
      {/each}
      {#if menuItems.length > 0 && (onFontSizeChange || onMonoToggle)}
        <hr class="popover-divider" />
      {/if}
      {#if onFontSizeChange}
        <div class="menu-control-row">
          <span class="menu-control-label">Font</span>
          <div class="menu-segmented">
            {#each FONT_SIZES as fs}
              <button
                class="menu-seg-btn"
                class:active={fontSize === fs.value}
                onclick={() => { onFontSizeChange(fs.value); }}
              >{fs.label}</button>
            {/each}
          </div>
        </div>
      {/if}
      {#if onMonoToggle}
        <div class="menu-control-row">
          <span class="menu-control-label">Mono</span>
          <button
            class="menu-toggle-btn"
            class:active={mono}
            onclick={() => { onMonoToggle(); }}
          >{mono ? 'ON' : 'OFF'}</button>
        </div>
      {/if}
      <div class="menu-control-row">
        <span class="menu-control-label">Raw</span>
        <button
          class="menu-toggle-btn"
          class:active={rawMode}
          onclick={() => { rawMode = !rawMode; }}
        >{rawMode ? 'ON' : 'OFF'}</button>
      </div>
      <hr class="popover-divider" />
      <button
        class="menu-item menu-item-danger"
        onclick={handleClear}
      >Clear</button>
    </div>
  {/if}

  {#if contextBar}
    {@render contextBar()}
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="m-chat-messages"
    class:mono
    bind:this={messagesEl}
    onclick={handleMessagesClick}
    onscroll={handleMessagesScroll}
    ontouchstart={handleMessagesTouch}
    onmousedown={handleMessagesTouch}
    style:font-size="{fontSize}px"
  >
    {#if !activeChatId && onCreateChat}
      <div class="chat-empty-state">
        <p>No chat selected</p>
        <button class="prompt-btn prompt-btn-primary" onclick={onCreateChat}>New chat</button>
      </div>
    {/if}
    {#each messages as msg, i (i)}
      {#if msg.role !== 'tool'}
        {#if msg.role === 'assistant'}
          <div class="marginalia-msg assistant" class:raw={rawMode} data-raw={msg.content}>
            {#if rawMode}
              <pre class="raw-content">{msg.content}</pre>
            {:else}
              {@html renderMarkdown(msg.content)}
            {/if}
            <div class="msg-actions">
              <button class="msg-action-btn" title="Copy" onclick={handleCopyClick}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
          </div>
        {:else if msg.role === 'system'}
          <div class="marginalia-msg system">{msg.content}</div>
        {:else}
          <div class="marginalia-msg user">
            {msg.content}
            {#if onTruncate}
              <div class="msg-actions" class:disabled={sending}>
                <button class="msg-action-btn" disabled={sending} title="Retry" onclick={() => { const text = msg.content; onTruncate(i); onSend(text); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
                <button class="msg-action-btn" disabled={sending} title="Edit" onclick={() => { inputText = msg.content; onTruncate(i); inputEl?.focus(); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    {/each}
    {#if toolActivitySnippet}
      {@render toolActivitySnippet()}
    {/if}
    {#if sending && (messages.length === 0 || messages[messages.length - 1]?.role !== 'assistant')}
      <div class="marginalia-msg assistant marginalia-thinking">
        <span class="thinking-dots">Thinking<span>.</span><span>.</span><span>.</span></span>
      </div>
    {/if}
  </div>

  {#if stats && (stats.cost > 0 || stats.inputTokens > 0)}
    <div class="chat-stats-bar">
      <span class="chat-stats-model">{stats.model || 'unknown'}</span>
      <span class="chat-stats-tokens">{(stats.inputTokens / 1000).toFixed(1)}k in / {(stats.outputTokens / 1000).toFixed(1)}k out</span>
      <span class="chat-stats-cost">${stats.cost.toFixed(4)}</span>
    </div>
  {/if}

  <div class="m-chat-input-area">
    <textarea
      class="m-chat-input"
      bind:this={inputEl}
      bind:value={inputText}
      {placeholder}
      onkeydown={handleKeydown}
    ></textarea>
    <button
      class="m-chat-send"
      class:done={sendDone}
      disabled={sending || !activeChatId}
      onmousedown={(e) => e.preventDefault()}
      onclick={handleSend}
    >{sendDone ? '\u2713' : 'Send'}</button>
  </div>
</div>

<style>
  .chat-panel {
    background: var(--m-bg-0);
    color: var(--m-fg);
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    font-weight: 400;
    overflow: hidden;
    position: relative;
    height: 100%;
    flex-shrink: 0;
    border-left: 1px solid var(--m-border);
  }
  .chat-panel.resizing {
    user-select: none;
  }

  .chat-resize-handle {
    position: absolute;
    left: -12px;
    top: 0;
    bottom: 0;
    width: 24px;
    cursor: col-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  }
  .chat-resize-handle::after {
    content: "";
    width: 4px;
    height: 48px;
    border-radius: 3px;
    background: var(--m-border-light);
    transition: background 0.15s;
  }
  .chat-resize-handle:hover::after,
  .chat-resize-handle:active::after {
    background: var(--m-accent);
  }

  .m-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--m-bg-1);
    border-bottom: 1px solid var(--m-border);
    flex-shrink: 0;
  }

  .chat-selector-btn {
    background: none;
    border: 1px solid var(--m-border-light);
    color: var(--m-fg);
    font-size: 13px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 200px;
  }
  @media (hover: hover) {
    .chat-selector-btn:hover { border-color: var(--m-accent); }
  }
  .chat-selector-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-selector-arrow {
    font-size: 10px;
    color: var(--m-fg-dim);
    flex-shrink: 0;
  }

  .chat-list-popover {
    position: absolute;
    top: 42px;
    left: 8px;
    background: var(--m-bg-1);
    border: 1px solid var(--m-border-light);
    border-radius: 8px;
    padding: 4px 0;
    z-index: 100;
    min-width: 220px;
    max-width: 300px;
    max-height: 300px;
    overflow-y: auto;
    box-shadow: 0 4px 16px var(--m-shadow);
  }
  .chat-list-item {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    gap: 6px;
  }
  .chat-list-item:hover { background: var(--m-bg-2); }
  .chat-list-item.active { background: var(--m-bg-2); }
  .chat-list-name {
    flex: 1;
    font-size: 13px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 0;
  }
  .chat-list-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    flex-shrink: 0;
  }
  .chat-list-item:hover .chat-list-actions { opacity: 1; }
  @media (hover: none) {
    .chat-list-actions { opacity: 0.7; }
  }
  .chat-list-action {
    background: none;
    border: none;
    color: var(--m-fg-dim);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
  }
  @media (hover: hover) {
    .chat-list-action:hover { color: var(--m-fg); background: var(--m-bg-3); }
    .chat-list-action-danger:hover { color: var(--m-error); }
  }
  .m-chat-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .m-chat-header-btn {
    background: none;
    border: none;
    color: var(--m-fg-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }
  @media (hover: hover) {
    .m-chat-header-btn:hover {
      color: var(--m-fg);
      background: var(--m-bg-2);
    }
  }

  .marginalia-popover {
    position: absolute;
    top: 42px;
    right: 8px;
    background: var(--m-bg-1);
    border: 1px solid var(--m-border-light);
    border-radius: 8px;
    padding: 8px 0;
    z-index: 100;
    min-width: 200px;
    box-shadow: 0 4px 16px var(--m-shadow);
  }

  .menu-item {
    display: block;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--m-fg);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover { background: var(--m-bg-2); }
  .menu-item-danger { color: var(--m-error); }
  .menu-item-danger:hover { background: rgba(251, 73, 52, 0.1); }

  .popover-divider {
    border: none;
    border-top: 1px solid var(--m-border);
    margin: 4px 0;
  }

  .menu-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    font-size: 13px;
    color: var(--m-fg);
  }
  .menu-control-label {
    color: var(--m-fg-muted);
  }
  .menu-segmented {
    display: flex;
    gap: 2px;
    background: var(--m-bg-2);
    border-radius: 6px;
    padding: 2px;
  }
  .menu-seg-btn {
    background: none;
    border: none;
    color: var(--m-fg-muted);
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .menu-seg-btn:hover { background: var(--m-bg-1); }
  .menu-seg-btn.active {
    background: var(--m-accent);
    color: var(--m-bg-0);
  }
  .menu-toggle-btn {
    background: var(--m-bg-2);
    border: 1px solid var(--m-border-light);
    color: var(--m-fg-muted);
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .menu-toggle-btn.active {
    background: var(--m-accent);
    color: var(--m-bg-0);
    border-color: var(--m-accent);
  }

  .chat-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    color: var(--m-fg-dim);
    font-size: 14px;
  }

  .m-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .m-chat-messages.mono {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  }

  :global(.marginalia-msg) {
    padding: 8px 12px;
    border-radius: 8px;
    word-break: break-word;
    line-height: 1.5;
    position: relative;
  }
  :global(.marginalia-msg.user) {
    align-self: flex-end;
    background: var(--m-user-bg);
    max-width: 85%;
    white-space: pre-wrap;
  }
  :global(.marginalia-msg.assistant) {
    background: var(--m-bg-1);
    border: 1px solid var(--m-border);
  }
  :global(.marginalia-msg.assistant code) {
    background: var(--m-code-bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  :global(.marginalia-msg.assistant pre) {
    background: var(--m-code-bg);
    padding: 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
  }
  :global(.marginalia-msg.assistant pre code) {
    background: none;
    padding: 0;
  }
  :global(.marginalia-msg.assistant strong) {
    color: var(--m-fg);
  }
  :global(.marginalia-msg.assistant h3),
  :global(.marginalia-msg.assistant h4) {
    margin: 12px 0 4px;
    color: var(--m-fg);
  }
  :global(.marginalia-msg.assistant table) {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 0.9em;
  }
  :global(.marginalia-msg.assistant th),
  :global(.marginalia-msg.assistant td) {
    border: 1px solid var(--m-border-light);
    padding: 6px 10px;
    text-align: left;
  }
  :global(.marginalia-msg.assistant th) {
    background: var(--m-code-bg);
    font-weight: 600;
    color: var(--m-fg);
  }
  :global(.marginalia-msg.assistant tr:nth-child(even)) {
    background: var(--m-bg-2);
  }
  :global(.marginalia-msg.assistant ol),
  :global(.marginalia-msg.assistant ul) {
    padding-left: 2em;
    margin: 4px 0;
  }
  :global(.marginalia-msg.system) {
    background: var(--m-system-bg);
    color: var(--m-system-fg);
    font-size: 0.85em;
    font-style: italic;
  }
  .msg-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .msg-actions.disabled {
    pointer-events: none;
    opacity: 0 !important;
  }
  @media (hover: hover) {
    :global(.marginalia-msg:hover) .msg-actions:not(.disabled) { opacity: 1; }
  }
  @media (hover: none) {
    .msg-actions:not(.disabled) { opacity: 1; }
  }
  .msg-action-btn {
    background: var(--m-bg-2);
    border: 1px solid var(--m-border-light);
    color: var(--m-fg-muted);
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  @media (hover: hover) {
    .msg-action-btn:hover { color: var(--m-fg); border-color: var(--m-fg-muted); }
    .msg-action-danger:hover { color: var(--m-error); border-color: var(--m-error); }
  }

  .raw-content {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.9em;
    margin: 0;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: var(--m-fg-muted);
  }

  :global(.marginalia-page-link) {
    color: var(--m-accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    cursor: pointer;
  }
  :global(.marginalia-page-link:hover) { text-decoration-style: solid; }

  :global(.marginalia-book-link) {
    color: var(--m-accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    cursor: pointer;
    font-weight: 600;
  }
  :global(.marginalia-book-link:hover) { text-decoration-style: solid; }

  :global(.thinking-dots span) {
    animation: blink 1.4s infinite both;
  }
  :global(.thinking-dots span:nth-child(2)) { animation-delay: 0.2s; }
  :global(.thinking-dots span:nth-child(3)) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }

  .chat-stats-bar {
    display: flex;
    gap: 12px;
    padding: 4px 12px;
    font-size: 11px;
    color: var(--m-fg-dim);
    border-top: 1px solid var(--m-border);
    flex-shrink: 0;
  }
  .chat-stats-model { color: var(--m-link); }
  .chat-stats-cost { margin-left: auto; }

  .m-chat-input-area {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    background: var(--m-bg-1);
    flex-shrink: 0;
  }
  .m-chat-input {
    flex: 1;
    background: var(--m-input-bg);
    color: var(--m-fg);
    border: 1px solid var(--m-border-light);
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
    resize: none;
    min-height: 36px;
    max-height: 120px;
    font-family: inherit;
  }
  .m-chat-send {
    background: var(--m-accent);
    color: var(--m-bg-0);
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    align-self: flex-end;
  }
  .m-chat-send:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .m-chat-send.done {
    background: var(--m-success);
    transition: background 0.3s;
  }
</style>
