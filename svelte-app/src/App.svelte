<script lang="ts">
  import { onMount } from 'svelte';
  import LibraryApp from './library/LibraryApp.svelte';
  import ViewerApp from './viewer/ViewerApp.svelte';
  import Toast from './lib/components/Toast.svelte';
  import { applyTheme } from './lib/state/settings.svelte';
  import { createChatState } from './lib/state/chat.svelte';
  import { createChatManager } from './lib/state/chat-manager.svelte';
  import { library } from './lib/state/library.svelte';
  import { router } from './lib/state/router.svelte';
  import { MARGINALIA_VERSION } from './lib/core/db';
  import { setOnBookChangeFn } from './lib/core/tools';
  import { getPdfjsLib } from './lib/core/pdfjs-loader';
  import { log } from './lib/core/logger';
  import { appStatus } from './lib/state/app-status.svelte';

  let startupError = $state<string | null>(null);

  const chatState = createChatState();
  const chatManager = createChatManager(chatState);

  async function loadDefaultBook() {
    if (library.books.length > 0) return;
    try {
      const res = await fetch('./default-book.pdf');
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      await library.addBook({
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

  onMount(() => {
    log('APP', 'onMount');
    applyTheme();
    router.init();
    setOnBookChangeFn((bookId: string) => router.navigateToViewer(bookId));
    chatManager.init();

    void (async () => {
      try {
        await library.load();
        await loadDefaultBook();
        if (router.activeBookId && !library.books.some(b => b.id === router.activeBookId)) {
          router.navigateToLibrary();
        }
        getPdfjsLib();
      } catch (err: any) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        log('APP', 'INIT_ERROR', err);
        startupError = msg;
        appStatus.notify(`Startup failed: ${msg}`, 'fatal', () => location.reload());
        router.navigateToLibrary();
      }
    })();
  });
</script>

<Toast />

{#if startupError}
  <div style="position:fixed;top:0;left:0;right:0;background:#fee;color:#900;padding:12px 16px;font-size:14px;z-index:999999;font-family:monospace;word-break:break-all;">
    Startup error: {startupError}
    <button onclick={() => location.reload()} style="margin-left:12px;padding:4px 12px;">Reload</button>
  </div>
{/if}

{#if router.currentView === 'library'}
  <LibraryApp
    {chatState}
    {chatManager}
    version={MARGINALIA_VERSION}
  />
{:else if router.activeBookId}
  <ViewerApp
    bookId={router.activeBookId}
    {chatState}
    {chatManager}
  />
{/if}
