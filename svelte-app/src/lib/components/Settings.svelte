<script lang="ts">
  import { settings } from '../state/settings.svelte';
  import { getLogs } from '../core/logger';
  import { buildDbDump, tryCopyToClipboard } from '../core/debug';
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
  let fallbackText = $state<string | null>(null);
  let fallbackInfo = $state('');

  $effect(() => {
    if (open) {
      apiKey = settings.apiKey;
      logsLabel = 'Copy logs';
      dbLabel = 'Copy DB';
    }
  });

  function handleSave() {
    settings.apiKey = apiKey.trim();
    onClose();
  }

  async function handleCopyLogs() {
    logsLabel = 'Copying...';
    const text = getLogs();
    const ok = await tryCopyToClipboard(text);
    if (ok) {
      logsLabel = `Copied (${text.length} chars)`;
      setTimeout(() => { logsLabel = 'Copy logs'; }, 2000);
    } else {
      logsLabel = 'Copy logs';
      fallbackText = text;
      fallbackInfo = `${text.length} chars — select all and copy manually`;
    }
  }

  async function handleCopyDb() {
    dbLabel = 'Copying...';
    try {
      const { json, books, folders } = await buildDbDump();
      const ok = await tryCopyToClipboard(json);
      if (ok) {
        dbLabel = `Copied ${books}b / ${folders}f`;
        setTimeout(() => { dbLabel = 'Copy DB'; }, 2000);
      } else {
        dbLabel = 'Copy DB';
        fallbackText = json;
        fallbackInfo = `${books} books, ${folders} folders — select all and copy manually`;
      }
    } catch (err) {
      dbLabel = 'Failed: ' + (err as Error).message;
      setTimeout(() => { dbLabel = 'Copy DB'; }, 3000);
    }
  }

  function closeFallback() {
    fallbackText = null;
    fallbackInfo = '';
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
  <div class="prompt-buttons">
    <button class="prompt-btn prompt-btn-primary" onclick={handleSave}>Save</button>
    <button class="prompt-btn" onclick={onClose}>Cancel</button>
  </div>
</Modal>

<Modal open={fallbackText !== null} onClose={closeFallback}>
  <h3>Manual copy</h3>
  <div class="fallback-info">{fallbackInfo}</div>
  <textarea class="fallback-textarea" readonly value={fallbackText ?? ''}></textarea>
  <div class="prompt-buttons">
    <button class="prompt-btn" onclick={closeFallback}>Close</button>
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

  .fallback-info {
    font-size: 12px;
    color: var(--m-fg-muted);
    margin-bottom: 8px;
  }

  .fallback-textarea {
    width: 100%;
    height: 300px;
    font-family: monospace;
    font-size: 11px;
    background: var(--m-bg);
    color: var(--m-fg);
    border: 1px solid var(--m-border);
    border-radius: 4px;
    padding: 8px;
    resize: vertical;
  }
</style>
