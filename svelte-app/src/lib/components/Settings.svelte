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

  $effect(() => {
    if (open) {
      apiKey = settings.apiKey;
      model = settings.model;
    }
  });

  function handleSave() {
    settings.apiKey = apiKey.trim();
    settings.model = model.trim();
    onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="prompt-overlay" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="prompt-modal" onclick={(e) => e.stopPropagation()}>
      <h3>Settings</h3>
      <label class="settings-label">
        OpenRouter API Key
        <input type="password" class="settings-input" bind:value={apiKey} placeholder="sk-or-v1-..." />
      </label>
      <label class="settings-label">
        Model
        <input type="text" class="settings-input" bind:value={model} placeholder="x-ai/grok-4.1-fast" />
      </label>
      <div class="prompt-buttons">
        <button class="prompt-btn prompt-btn-primary" onclick={handleSave}>Save</button>
        <button class="prompt-btn" onclick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

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
    padding: 10px;
    background: var(--m-input-bg);
    color: var(--m-fg);
    border: 1px solid var(--m-border-light);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    box-sizing: border-box;
  }
</style>
