<script lang="ts">
  import { onMount } from 'svelte';
  import Toolbar from '../lib/components/Toolbar.svelte';
  import BookGrid from '../lib/components/BookGrid.svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import Settings from '../lib/components/Settings.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import CompactEditor from '../lib/components/CompactEditor.svelte';
  import { settings, chatDisplay, getChatPrompt } from '../lib/state/settings.svelte';
  import type { ChatState } from '../lib/state/chat.svelte';
  import type { ChatManager } from '../lib/state/chat-manager.svelte';
  import { deleteChat } from '../lib/core/chat-registry';
  import { getBook, saveBook, deleteBook, deleteBookData, saveFolder, deleteFolder } from '../lib/core/db';
  import { buildLibraryContext } from '../lib/core/tools';
  import { buildChatMenuItems } from '../lib/core/chat-menu';
  import { sendChatMessage } from '../lib/core/chat-send';
  import { indexBook } from '../lib/core/indexer';
  import { buildLibraryAssistantPrompt } from '../lib/core/system-prompts';
  import type { Book, Folder } from '../lib/types';
  import {
    DEFAULT_CHAT_WIDTH,
    LS_LIB_CHAT_OPEN,
    LS_LIB_CHAT_WIDTH,
  } from '../lib/core/constants';

  let {
    books,
    folders,
    libraryLoaded,
    currentFolderId,
    chatState,
    chatManager,
    refreshLibrary,
    version,
    onOpenBook,
    onFolderChange,
  }: {
    books: Book[];
    folders: Folder[];
    libraryLoaded: boolean;
    currentFolderId: string | null;
    chatState: ChatState;
    chatManager: ChatManager;
    refreshLibrary: () => Promise<void>;
    version: number;
    onOpenBook: (book: Book) => void;
    onFolderChange: (id: string | null) => void;
  } = $props();

  let chatOpen = $state(localStorage.getItem(LS_LIB_CHAT_OPEN) === '1');
  let settingsOpen = $state(false);
  let promptEditorOpen = $state(false);
  let toolsEditorOpen = $state(false);
  let compactEditorOpen = $state(false);

  let chatWidth = $state(parseInt(localStorage.getItem(LS_LIB_CHAT_WIDTH) || String(DEFAULT_CHAT_WIDTH)));

  let uploadInput: HTMLInputElement;

  async function handleRenameBook(book: Book) {
    const name = prompt('Rename book:', book.title);
    if (name && name.trim()) {
      const fresh = await getBook(book.id);
      if (fresh) { fresh.title = name.trim(); await saveBook(fresh); }
      await refreshLibrary();
    }
  }

  async function handleDeleteBook(book: Book) {
    if (!confirm(`Delete "${book.title}"?`)) return;
    await deleteBook(book.id);
    deleteChat(book.id);
    deleteBookData(book.id);
    await refreshLibrary();
    chatManager.init();
  }

  async function handleMoveBook(book: Book) {
    const target = prompt(
      'Move to folder (type folder name, or empty for root):\n' +
      'Folders: ' + (folders.length ? folders.map(f => f.name).join(', ') : '(none)')
    );
    if (target === null) return;
    if (target.trim() === '') {
      const fresh = await getBook(book.id);
      if (fresh) { fresh.folder_id = null; await saveBook(fresh); }
      await refreshLibrary();
      return;
    }
    const folder = folders.find(f => f.name.toLowerCase() === target.trim().toLowerCase());
    if (folder) {
      const fresh = await getBook(book.id);
      if (fresh) { fresh.folder_id = folder.id; await saveBook(fresh); }
      await refreshLibrary();
    } else {
      alert(`Folder "${target}" not found.`);
    }
  }

  async function handleRenameFolder(folder: Folder) {
    const name = prompt('Rename folder:', folder.name);
    if (name && name.trim()) {
      folder.name = name.trim();
      await saveFolder(folder);
      await refreshLibrary();
    }
  }

  async function handleDeleteFolder(folder: Folder) {
    if (!confirm(`Delete folder "${folder.name}"? Books inside will move here.`)) return;
    const targetFolderId = folder.parent_id || null;
    // Move children up
    const childBooks = books.filter(b => b.folder_id === folder.id);
    for (const b of childBooks) {
      b.folder_id = targetFolderId;
      await saveBook(b);
    }
    const childFolders = folders.filter(f => f.parent_id === folder.id);
    for (const f of childFolders) {
      f.parent_id = targetFolderId;
      await saveFolder(f);
    }
    await deleteFolder(folder.id);
    if (currentFolderId === folder.id) {
      handleNavigateFolder(targetFolderId);
    }
    await refreshLibrary();
  }

  function handleNavigateFolder(folderId: string | null) {
    onFolderChange(folderId);
  }

  async function handleNewFolder() {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;
    const id = crypto.randomUUID();
    await saveFolder({ id, name: name.trim(), parent_id: currentFolderId, createdAt: Date.now() });
    await refreshLibrary();
  }

  async function handleUpload(file: File) {
    const data = await file.arrayBuffer();
    const id = crypto.randomUUID();
    await saveBook({
      id,
      title: file.name.replace(/\.pdf$/i, ''),
      filename: file.name,
      data,
      size: data.byteLength,
      pages: null,
      folder_id: currentFolderId,
      createdAt: Date.now(),
    });
    await refreshLibrary();
    // Index in background — refresh library when done to show page count
    indexBook(id).then(() => refreshLibrary());
  }

  function handleUploadInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      handleUpload(file);
      input.value = '';
    }
  }

  function toggleChat() {
    if (!chatOpen && !settings.apiKey) {
      alert('Set your OpenRouter API key in Settings first.');
      return;
    }
    chatOpen = !chatOpen;
    localStorage.setItem(LS_LIB_CHAT_OPEN, chatOpen ? '1' : '0');
  }

  async function handleChatSend(text: string) {
    if (!chatManager.activeChatId) return;
    await sendChatMessage(chatState, text, {
      buildSystemPrompt: (context: any) =>
        buildLibraryAssistantPrompt(
          context.libraryTree,
          getChatPrompt(chatManager.activeChatId!),
        ),
      storageKey: chatManager.activeChatId,
    });
  }

  function openChatPromptEditor() {
    if (!chatManager.activeChatId) {
      alert('Create a chat first.');
      return;
    }
    promptEditorOpen = true;
  }

  async function buildLibraryPromptPreview() {
    const context = await buildLibraryContext();
    return buildLibraryAssistantPrompt(
      context.libraryTree,
      chatManager.activeChatId ? getChatPrompt(chatManager.activeChatId) : '',
      chatState.summary,
    );
  }

  function handleChatClear() {
    if (chatState.messages.length === 0) return;
    if (!confirm('Clear conversation?')) return;
    chatState.clearMessages();
    chatState.setSummary(null);
    chatState.resetStats();
    if (chatManager.activeChatId) chatState.saveToStorage(chatManager.activeChatId);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (chatOpen && !compactEditorOpen && !promptEditorOpen && !toolsEditorOpen && !settingsOpen) {
        chatOpen = false;
        localStorage.setItem(LS_LIB_CHAT_OPEN, '0');
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app">
  <Toolbar title="Marginalia" subtitle="v{version}">
    {#snippet actions()}
      <label class="m-btn m-btn-lg" title="Upload PDF">
        +
        <input
          type="file"
          accept=".pdf"
          bind:this={uploadInput}
          onchange={handleUploadInput}
          hidden
        />
      </label>
      <button class="m-btn" title="New folder" onclick={handleNewFolder}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="m-btn" title="Settings" onclick={() => settingsOpen = true}>&#x2699;</button>
    {/snippet}
  </Toolbar>

  <div class="app-body">
    <BookGrid
      {books}
      {folders}
      {currentFolderId}
      onOpenBook={onOpenBook}
      onRenameBook={handleRenameBook}
      onDeleteBook={handleDeleteBook}
      onMoveBook={handleMoveBook}
      onNavigateFolder={handleNavigateFolder}
      onRenameFolder={handleRenameFolder}
      onDeleteFolder={handleDeleteFolder}
      onUpload={handleUpload}
      loading={!libraryLoaded}
    />

    {#if chatOpen}
      <ChatPanel
        placeholder={chatManager.activeChatId ? 'Ask about your library...' : 'Create a chat to start'}
        messages={chatState.messages}
        sending={chatState.sending}
        onSend={handleChatSend}
        onClear={handleChatClear}
        onClose={toggleChat}
        width={chatWidth}
        fontSize={chatDisplay.fontSize}
        mono={chatDisplay.mono}
        books={books.map(b => ({ id: b.id, title: b.title }))}
        onBookClick={(id) => onOpenBook({ id } as Book)}
        onResizeStart={() => {}}
        onResizeEnd={(w) => {
          chatWidth = w;
          localStorage.setItem(LS_LIB_CHAT_WIDTH, String(w));
        }}
        onFontSizeChange={(s) => { chatDisplay.fontSize = s; }}
        onMonoToggle={() => chatDisplay.toggleMono()}
        stats={chatState.stats}
        chats={chatManager.chats}
        activeChatId={chatManager.activeChatId}
        onSelectChat={chatManager.select}
        onCreateChat={() => chatManager.create('Library')}
        onRenameChat={chatManager.rename}
        onDeleteChat={chatManager.remove}
        onTruncate={chatManager.truncate}
        menuItems={buildChatMenuItems({
          editChatPrompt: openChatPromptEditor,
          configureTools: () => { toolsEditorOpen = true; },
          compact: () => { compactEditorOpen = true; },
        })}
      >
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

  <Settings open={settingsOpen} onClose={() => settingsOpen = false} />
  <PromptEditor
    open={promptEditorOpen}
    scope="chat"
    scopeId={chatManager.activeChatId || ''}
    title="System prompt for this chat"
    buildFullPrompt={buildLibraryPromptPreview}
    onClose={() => { promptEditorOpen = false; }}
  />
  <ToolsEditor open={toolsEditorOpen} onClose={() => { toolsEditorOpen = false; }} />
  <CompactEditor open={compactEditorOpen} bookId={chatManager.activeChatId || '_default'} onClose={() => { compactEditorOpen = false; }} onCompact={() => chatManager.compact(settings.apiKey, settings.model)} />

  {#if !chatOpen}
    <button class="m-chat-fab" title="Chat" onclick={toggleChat}>💬</button>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
