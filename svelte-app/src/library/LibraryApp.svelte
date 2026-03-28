<script lang="ts">
  import { onMount } from 'svelte';
  import Toolbar from '../lib/components/Toolbar.svelte';
  import BookGrid from '../lib/components/BookGrid.svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import Settings from '../lib/components/Settings.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import CompactEditor from '../lib/components/CompactEditor.svelte';
  import { settings, applyTheme, chatDisplay, getChatPrompt } from '../lib/state/settings.svelte';
  import { createChatState } from '../lib/state/chat.svelte';
  import { createChatManager } from '../lib/state/chat-manager.svelte';
  import { removeChatEntry } from '../lib/core/chat-registry';
  import { getAllBooks, getAllFolders, saveBook, deleteBook, deleteBookData, saveFolder, deleteFolder, MARGINALIA_VERSION } from '../lib/core/db';
  import { buildLibraryContext, setOnBookChangeFn } from '../lib/core/tools';
  import { buildChatMenuItems } from '../lib/core/chat-menu';
  import { sendChatMessage } from '../lib/core/chat-send';
  import { buildLibraryAssistantPrompt } from '../lib/core/system-prompts';
  import type { Book, Folder } from '../lib/types';
  import {
    DEFAULT_CHAT_WIDTH,
    LS_LIB_CHAT_OPEN,
    LS_LIB_CHAT_WIDTH,
    SS_BOOK_ID,
    SS_FOLDER_ID,
  } from '../lib/core/constants';

  let books = $state<Book[]>([]);
  let folders = $state<Folder[]>([]);
  let currentFolderId = $state<string | null>(sessionStorage.getItem(SS_FOLDER_ID) || null);
  let chatOpen = $state(localStorage.getItem(LS_LIB_CHAT_OPEN) === '1');
  let settingsOpen = $state(false);
  let promptEditorOpen = $state(false);
  let toolsEditorOpen = $state(false);
  let compactEditorOpen = $state(false);

  let chatWidth = $state(parseInt(localStorage.getItem(LS_LIB_CHAT_WIDTH) || String(DEFAULT_CHAT_WIDTH)));

  const chatState = createChatState();
  const chatManager = createChatManager(chatState);

  let uploadInput: HTMLInputElement;

  async function refreshLibrary() {
    books = await getAllBooks();
    folders = await getAllFolders();
    if (currentFolderId && !folders.some(folder => folder.id === currentFolderId)) {
      currentFolderId = null;
      sessionStorage.removeItem(SS_FOLDER_ID);
    }
  }

  function openBook(book: Book) {
    sessionStorage.setItem(SS_BOOK_ID, book.id);
    window.location.href = './viewer.html';
  }

  async function handleRenameBook(book: Book) {
    const name = prompt('Rename book:', book.title);
    if (name && name.trim()) {
      book.title = name.trim();
      await saveBook(book);
      await refreshLibrary();
    }
  }

  async function handleDeleteBook(book: Book) {
    if (!confirm(`Delete "${book.title}"?`)) return;
    await deleteBook(book.id);
    removeChatEntry(book.id);
    deleteBookData(book.id);
    await refreshLibrary();
    chatManager.init(books.map(b => ({ id: b.id, title: b.title })));
  }

  async function handleMoveBook(book: Book) {
    const target = prompt(
      'Move to folder (type folder name, or empty for root):\n' +
      'Folders: ' + (folders.length ? folders.map(f => f.name).join(', ') : '(none)')
    );
    if (target === null) return;
    if (target.trim() === '') {
      book.folder_id = null;
      await saveBook(book);
      await refreshLibrary();
      return;
    }
    const folder = folders.find(f => f.name.toLowerCase() === target.trim().toLowerCase());
    if (folder) {
      book.folder_id = folder.id;
      await saveBook(book);
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
    currentFolderId = folderId;
    if (folderId) {
      sessionStorage.setItem(SS_FOLDER_ID, folderId);
    } else {
      sessionStorage.removeItem(SS_FOLDER_ID);
    }
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
  }

  function handleUploadInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      handleUpload(file);
      input.value = '';
    }
  }

  async function handleCompact() {
    if (!chatManager.activeChatId) return;
    await chatState.compact(settings.apiKey, settings.model, chatManager.activeChatId);
    chatState.saveToStorage(chatManager.activeChatId);
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
      onAfterSend: () => { refreshLibrary(); },
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
    if (chatManager.activeChatId) chatState.saveToStorage(chatManager.activeChatId);
  }

  // Handle open_book from chat agent
  setOnBookChangeFn((bookId: string) => {
    sessionStorage.setItem(SS_BOOK_ID, bookId);
    window.location.href = './viewer.html';
  });

  async function loadDefaultBook() {
    const existing = await getAllBooks();
    if (existing.length > 0) return;
    try {
      const res = await fetch('./default-book.pdf');
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      await saveBook({
        id: '1984',
        title: '1984',
        filename: '1984.pdf',
        data,
        size: data.byteLength,
        pages: null,
        folder_id: null,
        createdAt: Date.now(),
      });
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Modals handle their own Escape via Modal.svelte
      if (chatOpen && !compactEditorOpen && !promptEditorOpen && !toolsEditorOpen && !settingsOpen) {
        chatOpen = false;
        localStorage.setItem(LS_LIB_CHAT_OPEN, '0');
      }
    }
  }

  onMount(async () => {
    applyTheme();
    sessionStorage.removeItem(SS_BOOK_ID);
    await loadDefaultBook();
    await refreshLibrary();

    chatManager.init(books.map(b => ({ id: b.id, title: b.title })));
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app">
  <Toolbar title="Marginalia" subtitle="v{MARGINALIA_VERSION}">
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
      onOpenBook={openBook}
      onRenameBook={handleRenameBook}
      onDeleteBook={handleDeleteBook}
      onMoveBook={handleMoveBook}
      onNavigateFolder={handleNavigateFolder}
      onRenameFolder={handleRenameFolder}
      onDeleteFolder={handleDeleteFolder}
      onUpload={handleUpload}
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
        onBookClick={(id) => {
          sessionStorage.setItem(SS_BOOK_ID, id);
          window.location.href = './viewer.html';
        }}
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
  <CompactEditor open={compactEditorOpen} bookId={chatManager.activeChatId || '_default'} onClose={() => { compactEditorOpen = false; }} onCompact={handleCompact} />

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
