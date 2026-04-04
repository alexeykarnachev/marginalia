<script lang="ts">
  import type { Snippet } from 'svelte';
  import ChatPanel from './ChatPanel.svelte';
  import PromptEditor from './PromptEditor.svelte';
  import ToolsEditor from './ToolsEditor.svelte';
  import CompactEditor from './CompactEditor.svelte';
  import { settings, chatDisplay } from '../state/settings.svelte';
  import { library } from '../state/library.svelte';
  import type { ChatState } from '../state/chat.svelte';
  import type { ChatManager } from '../state/chat-manager.svelte';
  import { buildChatMenuItems } from '../core/chat-menu';
  import { DEFAULT_CHAT_WIDTH } from '../core/constants';

  let {
    chatState,
    chatManager,
    openStorageKey,
    widthStorageKey,
    placeholder,
    defaultChatName = 'Chat',
    onSend,
    onBookClick,
    // Prompt editor config
    promptEditorScope = 'chat',
    promptEditorScopeId,
    promptEditorTitle = 'System prompt for this chat',
    buildFullPrompt,
    // Compact editor
    compactBookId,
    // Optional: extra menu items
    extraMenuCallbacks = {},
    // Optional: viewer-specific
    pageNavEnabled = false,
    onPageNav,
    onResizeStart,
    onResizeEnd: onResizeEndCallback,
    contextBar,
    toolActivitySnippet,
    // Optional: extra modals open check (e.g. settingsOpen in library)
    hasExtraModalsOpen = false,
  }: {
    chatState: ChatState;
    chatManager: ChatManager;
    openStorageKey: string;
    widthStorageKey: string;
    placeholder: string;
    defaultChatName?: string;
    onSend: (text: string) => void;
    onBookClick: (id: string) => void;
    promptEditorScope?: 'book' | 'chat';
    promptEditorScopeId: string;
    promptEditorTitle?: string;
    buildFullPrompt: () => Promise<string>;
    compactBookId: string;
    extraMenuCallbacks?: Record<string, () => void>;
    pageNavEnabled?: boolean;
    onPageNav?: (page: number) => void;
    onResizeStart?: () => void;
    onResizeEnd?: () => void;
    contextBar?: Snippet;
    toolActivitySnippet?: Snippet;
    hasExtraModalsOpen?: boolean;
  } = $props();

  let chatOpen = $state(localStorage.getItem(openStorageKey) === '1');
  let chatWidth = $state(parseInt(localStorage.getItem(widthStorageKey) || String(DEFAULT_CHAT_WIDTH)));
  let promptEditorOpen = $state(false);
  let toolsEditorOpen = $state(false);
  let compactEditorOpen = $state(false);
  let chatPanelRef: ChatPanel;

  export function isOpen() { return chatOpen; }
  export function isResizing() { return _resizing; }
  let _resizing = $state(false);

  function toggleChat() {
    if (!chatOpen && !settings.apiKey) {
      alert('Set your OpenRouter API key in Settings first.');
      return;
    }
    chatOpen = !chatOpen;
    localStorage.setItem(openStorageKey, chatOpen ? '1' : '0');
  }

  function handleChatClear() {
    if (chatState.messages.length === 0) return;
    if (!confirm('Clear conversation?')) return;
    chatState.clearMessages();
    chatState.resetStats();
    if (chatManager.activeChatId) chatState.saveToStorage(chatManager.activeChatId);
  }

  function openPromptEditor() {
    if (!chatManager.activeChatId) {
      alert('Create a chat first.');
      return;
    }
    promptEditorOpen = true;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (chatOpen && !compactEditorOpen && !promptEditorOpen && !toolsEditorOpen && !hasExtraModalsOpen) {
        chatOpen = false;
        localStorage.setItem(openStorageKey, '0');
      }
    }
  }

  const menuItems = $derived(buildChatMenuItems({
    editChatPrompt: openPromptEditor,
    configureTools: () => { toolsEditorOpen = true; },
    compact: () => { compactEditorOpen = true; },
    ...extraMenuCallbacks,
  }));
</script>

<svelte:window onkeydown={handleKeydown} />

{#if chatOpen}
  <ChatPanel
    bind:this={chatPanelRef}
    {placeholder}
    messages={chatState.messages}
    sending={chatState.sending}
    onSend={onSend}
    onStop={() => chatState.abort()}
    onClear={handleChatClear}
    onClose={toggleChat}
    width={chatWidth}
    fontSize={chatDisplay.fontSize}
    mono={chatDisplay.mono}
    books={library.books.map(b => ({ id: b.id, title: b.title }))}
    {onBookClick}
    {pageNavEnabled}
    {onPageNav}
    onResizeStart={() => { _resizing = true; onResizeStart?.(); }}
    onResizeEnd={(w) => {
      _resizing = false;
      chatWidth = w;
      localStorage.setItem(widthStorageKey, String(w));
      onResizeEndCallback?.();
    }}
    onFontSizeChange={(s) => { chatDisplay.fontSize = s; }}
    onMonoToggle={() => chatDisplay.toggleMono()}
    stats={chatState.stats}
    chats={chatManager.chats}
    activeChatId={chatManager.activeChatId}
    onSelectChat={chatManager.select}
    onCreateChat={() => chatManager.create(defaultChatName)}
    onRenameChat={chatManager.rename}
    onDeleteChat={chatManager.remove}
    onTruncate={chatManager.truncate}
    {menuItems}
    {contextBar}
    {toolActivitySnippet}
  />
{/if}

<PromptEditor
  open={promptEditorOpen}
  scope={promptEditorScope}
  scopeId={promptEditorScopeId}
  title={promptEditorTitle}
  {buildFullPrompt}
  onClose={() => { promptEditorOpen = false; }}
/>
<ToolsEditor open={toolsEditorOpen} onClose={() => { toolsEditorOpen = false; }} />
<CompactEditor open={compactEditorOpen} bookId={compactBookId} onClose={() => { compactEditorOpen = false; }} onCompact={() => { chatPanelRef?.scrollToBottom(); chatManager.compact(settings.apiKey, settings.model); }} />

{#if !chatOpen}
  <button class="m-chat-fab" title="Chat" onclick={toggleChat}>💬</button>
{/if}
