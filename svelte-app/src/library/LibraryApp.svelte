<script lang="ts">
  import Toolbar from '../lib/components/Toolbar.svelte';
  import BookGrid from '../lib/components/BookGrid.svelte';
  import ChatSidebar from '../lib/components/ChatSidebar.svelte';
  import Settings from '../lib/components/Settings.svelte';
  import { copyLogs } from '../lib/core/logger';
  import { getChatPrompt } from '../lib/state/settings.svelte';
  import { library } from '../lib/state/library.svelte';
  import { router } from '../lib/state/router.svelte';
  import type { ChatState } from '../lib/state/chat.svelte';
  import type { ChatManager } from '../lib/state/chat-manager.svelte';
  import { deleteChat } from '../lib/core/chat-registry';
  import { sendChatMessage } from '../lib/core/chat-send';
  import { indexBook } from '../lib/core/indexer';
  import { buildLibraryAssistantPrompt } from '../lib/core/system-prompts';
  import type { BookMeta, Folder } from '../lib/types';
  import { LS_LIB_CHAT_OPEN, LS_LIB_CHAT_WIDTH } from '../lib/core/constants';

  let {
    chatState,
    chatManager,
    version,
  }: {
    chatState: ChatState;
    chatManager: ChatManager;
    version: number;
  } = $props();

  let settingsOpen = $state(false);

  async function handleRenameBook(book: BookMeta) {
    const name = prompt('Rename book:', book.title);
    if (name && name.trim()) {
      await library.updateBook(book.id, { title: name.trim() });
    }
  }

  async function handleDeleteBook(book: BookMeta) {
    if (!confirm(`Delete "${book.title}"?`)) return;
    await library.deleteBook(book.id);
    deleteChat(book.id);
    chatManager.init();
  }

  async function handleMoveBook(book: BookMeta) {
    const target = prompt(
      'Move to folder (type folder name, or empty for root):\n' +
      'Folders: ' + (library.folders.length ? library.folders.map(f => f.name).join(', ') : '(none)')
    );
    if (target === null) return;
    if (target.trim() === '') {
      await library.updateBook(book.id, { folder_id: null });
      return;
    }
    const folder = library.folders.find(f => f.name.toLowerCase() === target.trim().toLowerCase());
    if (folder) {
      await library.updateBook(book.id, { folder_id: folder.id });
    } else {
      alert(`Folder "${target}" not found.`);
    }
  }

  async function handleArchiveBook(book: BookMeta) {
    await library.updateBook(book.id, { archived: !book.archived });
  }

  async function handleRenameFolder(folder: Folder) {
    const name = prompt('Rename folder:', folder.name);
    if (name && name.trim()) {
      await library.updateFolder(folder.id, { name: name.trim() });
    }
  }

  async function handleDeleteFolder(folder: Folder) {
    if (!confirm(`Delete folder "${folder.name}"? Books inside will move here.`)) return;
    const targetFolderId = folder.parent_id || null;
    const childBooks = library.books.filter(b => b.folder_id === folder.id);
    if (childBooks.length > 0) {
      await library.updateBooksBatch(childBooks.map(b => ({ id: b.id, patch: { folder_id: targetFolderId } })));
    }
    const childFolders = library.folders.filter(f => f.parent_id === folder.id);
    if (childFolders.length > 0) {
      await library.saveFoldersBatch(childFolders.map(f => ({ ...f, parent_id: targetFolderId })));
    }
    await library.deleteFolder(folder.id);
    if (router.currentFolderId === folder.id) {
      router.setFolder(targetFolderId);
    }
  }

  async function handleNewFolder() {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;
    const id = crypto.randomUUID();
    await library.addFolder({ id, name: name.trim(), parent_id: router.currentFolderId, createdAt: Date.now() });
  }

  async function handleUpload(file: File) {
    const data = await file.arrayBuffer();
    const id = crypto.randomUUID();
    await library.addBook({
      id,
      title: file.name.replace(/\.pdf$/i, ''),
      filename: file.name,
      data,
      size: data.byteLength,
      pages: null,
      folder_id: router.currentFolderId,
      createdAt: Date.now(),
    });
    indexBook(id).then(() => library.load());
  }

  function handleUploadInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      handleUpload(file);
      input.value = '';
    }
  }

  async function handleChatSend(text: string) {
    if (!chatManager.activeChatId) return;
    await sendChatMessage(chatState, text, {
      buildSystemPrompt: () =>
        buildLibraryAssistantPrompt(
          getChatPrompt(chatManager.activeChatId!),
        ),
      storageKey: chatManager.activeChatId,
    });
  }

  function buildPromptPreview() {
    return Promise.resolve(buildLibraryAssistantPrompt(
      chatManager.activeChatId ? getChatPrompt(chatManager.activeChatId) : '',
    ));
  }
</script>

<div class="app">
  <Toolbar title="Marginalia" subtitle="v{version}">
    {#snippet actions()}
      <label class="m-btn m-btn-lg" title="Upload PDF">
        +
        <input type="file" accept=".pdf" onchange={handleUploadInput} hidden />
      </label>
      <button class="m-btn" title="New folder" onclick={handleNewFolder}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="m-btn" title="Copy logs" onclick={copyLogs}>&#x1F4CB;</button>
      <button class="m-btn" title="Settings" onclick={() => settingsOpen = true}>&#x2699;</button>
    {/snippet}
  </Toolbar>

  <div class="app-body">
    <BookGrid
      books={library.books}
      folders={library.folders}
      currentFolderId={router.currentFolderId}
      onOpenBook={(book) => router.navigateToViewer(book.id)}
      onRenameBook={handleRenameBook}
      onDeleteBook={handleDeleteBook}
      onMoveBook={handleMoveBook}
      onArchiveBook={handleArchiveBook}
      onNavigateFolder={(id) => router.setFolder(id)}
      onRenameFolder={handleRenameFolder}
      onDeleteFolder={handleDeleteFolder}
      onUpload={handleUpload}
      loading={!library.loaded}
    />

    <ChatSidebar
      {chatState}
      {chatManager}
      openStorageKey={LS_LIB_CHAT_OPEN}
      widthStorageKey={LS_LIB_CHAT_WIDTH}
      placeholder={chatManager.activeChatId ? 'Ask about your library...' : 'Create a chat to start'}
      defaultChatName="Library"
      onSend={handleChatSend}
      onBookClick={(id) => router.navigateToViewer(id)}
      promptEditorScopeId={chatManager.activeChatId || ''}
      promptEditorTitle="System prompt for this chat"
      buildFullPrompt={buildPromptPreview}
      compactBookId={chatManager.activeChatId || '_default'}
      hasExtraModalsOpen={settingsOpen}
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
    </ChatSidebar>
  </div>

  <Settings open={settingsOpen} onClose={() => settingsOpen = false} />
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
