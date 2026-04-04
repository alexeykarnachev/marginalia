<script lang="ts">
  import { settings } from '../state/settings.svelte';
  import Modal from './Modal.svelte';

  let {
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let apiKey = $state(settings.apiKey);

  $effect(() => {
    if (open) {
      apiKey = settings.apiKey;
    }
  });

  function handleSave() {
    settings.apiKey = apiKey.trim();
    onClose();
  }
</script>

<Modal {open} {onClose}>
  <h3>Settings</h3>
  <label class="settings-label">
    OpenRouter API Key
    <input type="text" class="prompt-textarea settings-input" bind:value={apiKey} placeholder="sk-or-v1-..." />
  </label>
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
</style>
