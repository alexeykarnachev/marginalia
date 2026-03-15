<script lang="ts">
  import { onMount } from 'svelte';
  import Toolbar from '../lib/components/Toolbar.svelte';
  import BookGrid from '../lib/components/BookGrid.svelte';
  import ChatPanel from '../lib/components/ChatPanel.svelte';
  import Settings from '../lib/components/Settings.svelte';
  import PromptEditor from '../lib/components/PromptEditor.svelte';
  import ToolsEditor from '../lib/components/ToolsEditor.svelte';
  import { settings, applyTheme } from '../lib/state/settings.svelte';
  import { createChatState } from '../lib/state/chat.svelte';
  import { getAllBooks, getAllFolders, saveBook, deleteBook, deleteBookData, saveFolder, deleteFolder, getSettings, MARGINALIA_VERSION } from '../lib/core/db';
  import { buildLibraryContext, setOnBookChangeFn } from '../lib/core/tools';
  import { agentLoop } from '../lib/core/agent';
  import { compactMessages } from '../lib/core/prompt';
  import type { Book, Folder, ChatMessage } from '../lib/types';

  let books = $state<Book[]>([]);
  let folders = $state<Folder[]>([]);
  let currentFolderId = $state<string | null>(null);
  let chatOpen = $state(localStorage.getItem('marginalia_lib_chat_open') === '1');
  let settingsOpen = $state(false);
  let promptEditorOpen = $state(false);
  let toolsEditorOpen = $state(false);

  // Chat font/mono settings
  let chatFontSize = $state(parseInt(localStorage.getItem('marginalia_lib_chat_font') || '14'));
  let chatMono = $state(localStorage.getItem('marginalia_lib_chat_mono') === '1');
  let chatWidth = $state(parseInt(localStorage.getItem('marginalia_lib_chat_width') || '380'));

  const FONT_SIZES = [
    { label: 'S', size: 12 },
    { label: 'M', size: 14 },
    { label: 'L', size: 16 },
  ];

  function setFontSize(size: number) {
    chatFontSize = size;
    localStorage.setItem('marginalia_lib_chat_font', String(size));
  }

  function toggleMono() {
    chatMono = !chatMono;
    localStorage.setItem('marginalia_lib_chat_mono', chatMono ? '1' : '0');
  }

  const chatState = createChatState();

  let uploadInput: HTMLInputElement;

  async function refreshLibrary() {
    books = await getAllBooks();
    folders = await getAllFolders();
  }

  function openBook(book: Book) {
    sessionStorage.setItem('marginalia_book_id', book.id);
    window.location.href = '/viewer.html';
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
    deleteBookData(book.id);
    await refreshLibrary();
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
    // Move children up
    const childBooks = books.filter(b => b.folder_id === folder.id);
    for (const b of childBooks) {
      b.folder_id = currentFolderId;
      await saveBook(b);
    }
    const childFolders = folders.filter(f => f.parent_id === folder.id);
    for (const f of childFolders) {
      f.parent_id = currentFolderId;
      await saveFolder(f);
    }
    await deleteFolder(folder.id);
    await refreshLibrary();
  }

  function handleNavigateFolder(folderId: string | null) {
    currentFolderId = folderId;
  }

  async function handleNewFolder() {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;
    const id = crypto.randomUUID();
    await saveFolder({ id, name: name.trim(), parent_id: currentFolderId });
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
    if (!settings.apiKey) return;
    const convCount = chatState.messages.filter(
      (m: ChatMessage) => m.role === 'user' || m.role === 'assistant'
    ).length;
    if (convCount < 6) return;
    chatState.addMessage({ role: 'system', content: 'Compacting...' });
    try {
      const result = await compactMessages(settings.apiKey, settings.model, chatState.messages, chatState.summary);
      chatState.setMessages(result.messages);
      chatState.setSummary(result.summary);
    } catch (err: any) {
      chatState.setMessages(chatState.messages.filter((m: ChatMessage) => m.content !== 'Compacting...'));
      chatState.addMessage({ role: 'system', content: `Compact failed: ${err.message}` });
    }
  }

  function toggleChat() {
    if (!chatOpen && !settings.apiKey) {
      alert('Set your OpenRouter API key in Settings first.');
      return;
    }
    chatOpen = !chatOpen;
    localStorage.setItem('marginalia_lib_chat_open', chatOpen ? '1' : '0');
  }

  async function handleChatSend(text: string) {
    if (!settings.apiKey) {
      alert('Set your OpenRouter API key in Settings first.');
      return;
    }
    chatState.addMessage({ role: 'user', content: text });
    chatState.setSending(true);

    try {
      const context = await buildLibraryContext();
      const system = `You are Marginalia, an AI library assistant. Help the user manage and explore their book library.
You have access to tools for searching, organizing, and reading books.
Respond in the user's language. Be concise.

## Library
${context.libraryTree}`;

      const apiMessages: ChatMessage[] = [
        { role: 'system', content: system },
        ...chatState.messages.filter((m: ChatMessage) => m.role !== 'system'),
      ];

      const result = await agentLoop(settings.apiKey, settings.model, apiMessages, {
        onDelta: (_delta: string, full: string) => {
          const msgs = chatState.messages;
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            chatState.updateLastMessage(full);
          } else {
            chatState.addMessage({ role: 'assistant', content: full });
          }
        },
        onToolCall: () => {},
        onToolResult: () => {},
        onThinking: () => {},
        onUsage: () => {},
      });

      // Ensure final content
      const msgs = chatState.messages;
      const last = msgs[msgs.length - 1];
      if (result.content && (!last || last.role !== 'assistant')) {
        chatState.addMessage({ role: 'assistant', content: result.content });
      } else if (result.content && last?.role === 'assistant') {
        chatState.updateLastMessage(result.content);
      }
      await refreshLibrary();
    } catch (err: any) {
      chatState.addMessage({ role: 'system', content: 'Error: ' + err.message });
    }

    chatState.setSending(false);
    chatState.saveToStorage('_library');
  }

  function handleChatClear() {
    if (chatState.messages.length === 0) return;
    if (!confirm('Clear conversation?')) return;
    chatState.clearMessages();
    chatState.setSummary(null);
  }

  // Handle open_book from chat agent
  setOnBookChangeFn((bookId: string) => {
    sessionStorage.setItem('marginalia_book_id', bookId);
    window.location.href = '/viewer.html';
  });

  async function loadDefaultBook() {
    const existing = await getAllBooks();
    if (existing.length > 0) return;
    try {
      const res = await fetch('/default-book.pdf');
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
      });
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (promptEditorOpen) { promptEditorOpen = false; return; }
      if (toolsEditorOpen) { toolsEditorOpen = false; return; }
      if (settingsOpen) { settingsOpen = false; return; }
      if (chatOpen) { chatOpen = false; localStorage.setItem('marginalia_lib_chat_open', '0'); return; }
    }
  }

  onMount(async () => {
    applyTheme();
    // Clear current book context — library page has no "current book"
    sessionStorage.removeItem('marginalia_book_id');
    chatState.loadFromStorage('_library');
    await loadDefaultBook();
    await refreshLibrary();
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
        placeholder="Ask about your library..."
        messages={chatState.messages}
        sending={chatState.sending}
        onSend={handleChatSend}
        onClear={handleChatClear}
        onClose={toggleChat}
        width={chatWidth}
        fontSize={chatFontSize}
        mono={chatMono}
        books={books.map(b => ({ id: b.id, title: b.title }))}
        onBookClick={(id) => {
          sessionStorage.setItem('marginalia_book_id', id);
          window.location.href = '/viewer.html';
        }}
        onResizeStart={() => {}}
        onResizeEnd={(w) => {
          chatWidth = w;
          localStorage.setItem('marginalia_lib_chat_width', String(w));
        }}
        onFontSizeChange={setFontSize}
        onMonoToggle={toggleMono}
        stats={chatState.stats}
        menuItems={[
          { label: 'Edit prompt', onClick: () => { promptEditorOpen = true; } },
          { label: 'Configure tools', onClick: () => { toolsEditorOpen = true; } },
          { label: 'Compact', onClick: handleCompact },
        ]}
      />
    {/if}
  </div>

  <Settings open={settingsOpen} onClose={() => settingsOpen = false} />
  <PromptEditor open={promptEditorOpen} bookId="_library" onClose={() => { promptEditorOpen = false; }} />
  <ToolsEditor open={toolsEditorOpen} onClose={() => { toolsEditorOpen = false; }} />

  {#if !chatOpen}
    <button class="m-chat-fab" title="Chat" onclick={toggleChat}>💬</button>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
