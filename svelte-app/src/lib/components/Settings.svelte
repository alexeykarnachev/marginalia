<script lang="ts">
  import { settings } from '../state/settings.svelte';

  let {
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let apiKey = $state(settings.apiKey);
  let model = $state(settings.model);
  let autoCompact = $state(settings.autoCompact);
  let compactThreshold = $state(settings.compactThreshold);

  // Sync form values when modal opens
  $effect(() => {
    if (open) {
      apiKey = settings.apiKey;
      model = settings.model;
      autoCompact = settings.autoCompact;
      compactThreshold = settings.compactThreshold;
    }
  });

  function handleSave() {
    settings.apiKey = apiKey.trim();
    settings.model = model.trim();
    settings.autoCompact = autoCompact;
    settings.compactThreshold = compactThreshold;
    onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={handleBackdropClick}>
    <div class="modal">
      <h2>Settings</h2>
      <label>
        OpenRouter API Key
        <input type="password" bind:value={apiKey} placeholder="sk-or-v1-..." />
      </label>
      <label>
        Model
        <input type="text" bind:value={model} placeholder="x-ai/grok-4.1-fast" />
      </label>
      <hr class="modal-divider" />
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={autoCompact} />
        Auto-compact conversation
      </label>
      <label>
        Compact threshold (tokens)
        <input type="number" bind:value={compactThreshold} min={10000} step={5000} />
      </label>
      <div class="modal-buttons">
        <button class="btn-save" onclick={handleSave}>Save</button>
        <button class="btn-cancel" onclick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: var(--m-overlay-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--m-bg-1);
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 400px;
  }

  .modal h2 { margin-bottom: 16px; font-size: 18px; }

  .modal label {
    display: block;
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--m-fg-muted);
  }

  .modal input[type="text"],
  .modal input[type="password"],
  .modal input[type="number"] {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 10px;
    background: var(--m-input-bg);
    color: var(--m-fg);
    border: 1px solid var(--m-border-light);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    box-sizing: border-box;
  }

  .modal-divider {
    border: none;
    border-top: 1px solid var(--m-border-light);
    margin: 16px 0;
  }

  .checkbox-label {
    display: flex !important;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--m-accent);
  }

  .modal-buttons {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }

  .modal-buttons button {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }

  .btn-save { background: var(--m-accent); color: var(--m-bg-0); font-weight: 600; }
  .btn-cancel { background: var(--m-bg-2); color: var(--m-fg-muted); }
</style>
