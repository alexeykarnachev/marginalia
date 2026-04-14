<script lang="ts">
  import { settings } from '../state/settings.svelte';
  import { getLogs } from '../core/logger';
  import { buildDbDump, copyTextViaPromise } from '../core/debug';
  import { library } from '../state/library.svelte';
  import Modal from './Modal.svelte';

  let {
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let apiKey = $state(settings.apiKey);
  let logsLabel = $state('Copy logs');
  let dbLabel = $state('Copy DB');
  let repairLabel = $state('Repair library');
  let unarchiveAll = $state(false);

  $effect(() => {
    if (open) {
      apiKey = settings.apiKey;
      logsLabel = 'Copy logs';
      dbLabel = 'Copy DB';
      repairLabel = 'Repair library';
      unarchiveAll = false;
    }
  });

  function handleSave() {
    settings.apiKey = apiKey.trim();
    onClose();
  }

  // Synchronous click handlers — must call clipboard API inside the same tick
  // as the user gesture. iOS Safari accepts ClipboardItem with a Promise payload
  // as long as the ClipboardItem is constructed synchronously during the gesture.

  function handleCopyLogs() {
    const text = getLogs();
    copyTextViaPromise(Promise.resolve(text))
      .then(() => {
        logsLabel = `Copied (${text.length} chars)`;
      })
      .catch((err) => {
        logsLabel = 'Failed: ' + (err as Error).message;
      })
      .finally(() => {
        setTimeout(() => { logsLabel = 'Copy logs'; }, 2000);
      });
    logsLabel = 'Copying...';
  }

  function handleCopyDb() {
    let books = 0;
    let folders = 0;
    const textPromise = buildDbDump().then(({ json, books: b, folders: f }) => {
      books = b;
      folders = f;
      return json;
    });
    copyTextViaPromise(textPromise)
      .then(() => {
        dbLabel = `Copied ${books}b / ${folders}f`;
      })
      .catch((err) => {
        dbLabel = 'Failed: ' + (err as Error).message;
      })
      .finally(() => {
        setTimeout(() => { dbLabel = 'Copy DB'; }, 2000);
      });
    dbLabel = 'Copying...';
  }

  async function handleRepair() {
    repairLabel = 'Repairing...';
    try {
      const orphans = await library.repairOrphans();
      let unarchived = 0;
      if (unarchiveAll) {
        unarchived = await library.unarchiveAll();
      }
      const parts: string[] = [];
      parts.push(`${orphans.length} orphan(s)`);
      if (unarchiveAll) parts.push(`${unarchived} unarchived`);
      repairLabel = `Done: ${parts.join(', ')}`;
    } catch (err) {
      repairLabel = 'Failed: ' + (err as Error).message;
    }
    setTimeout(() => { repairLabel = 'Repair library'; }, 3000);
  }
</script>

<Modal {open} {onClose}>
  <h3>Settings</h3>
  <label class="settings-label">
    OpenRouter API Key
    <input type="text" class="prompt-textarea settings-input" bind:value={apiKey} placeholder="sk-or-v1-..." />
  </label>
  <div class="settings-section">
    <div class="settings-section-label">Debug</div>
    <div class="settings-debug-row">
      <button class="prompt-btn" onclick={handleCopyLogs}>{logsLabel}</button>
      <button class="prompt-btn" onclick={handleCopyDb}>{dbLabel}</button>
    </div>
  </div>
  <div class="settings-section">
    <div class="settings-section-label">Recovery</div>
    <label class="settings-check">
      <input type="checkbox" bind:checked={unarchiveAll} />
      Also unarchive all archived books
    </label>
    <div class="settings-debug-row">
      <button class="prompt-btn" onclick={handleRepair}>{repairLabel}</button>
    </div>
  </div>
  <div class="prompt-buttons">
    <button class="prompt-btn prompt-btn-primary" onclick={handleSave}>Save</button>
    <button class="prompt-btn" onclick={onClose}>Cancel</button>
  </div>
</Modal>

<style>
  .settings-label {
    display: block;
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--m-fg-muted);
  }

  .settings-input {
    display: block;
    width: 100%;
    margin-top: 6px;
    min-height: auto;
    resize: none;
  }

  .settings-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--m-border);
  }

  .settings-section-label {
    font-size: 12px;
    color: var(--m-fg-muted);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .settings-debug-row {
    display: flex;
    gap: 8px;
  }

  .settings-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--m-fg-muted);
    margin-bottom: 8px;
  }
</style>
