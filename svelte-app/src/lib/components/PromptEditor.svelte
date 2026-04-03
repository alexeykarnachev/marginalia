<script lang="ts">
  import { getBookPrompt, getChatPrompt, setBookPrompt, setChatPrompt } from '../state/settings.svelte';
  import Modal from './Modal.svelte';

  let {
    open,
    scopeId,
    scope = 'book',
    title = 'System prompt',
    onClose,
    buildFullPrompt,
  }: {
    open: boolean;
    scopeId: string;
    scope?: 'book' | 'chat';
    title?: string;
    onClose: () => void;
    buildFullPrompt?: () => Promise<string>;
  } = $props();

  let promptText = $state('');
  let showFullPrompt = $state(false);
  let fullPromptText = $state('');
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      promptText = scope === 'chat' ? getChatPrompt(scopeId) : getBookPrompt(scopeId);
      showFullPrompt = false;
      fullPromptText = '';
    }
    wasOpen = open;
  });

  function handleSave() {
    if (scope === 'chat') {
      setChatPrompt(scopeId, promptText.trim());
    } else {
      setBookPrompt(scopeId, promptText.trim());
    }
    onClose();
  }

  async function toggleFullPrompt() {
    if (showFullPrompt) {
      showFullPrompt = false;
      return;
    }
    if (!buildFullPrompt) {
      fullPromptText = promptText.trim() || '(default prompt only)';
      showFullPrompt = true;
      return;
    }
    fullPromptText = await buildFullPrompt();
    showFullPrompt = true;
  }
</script>

<Modal {open} {onClose}>
  <h3>{title}</h3>
  <p class="prompt-hint">This text is appended to the base system prompt. Leave empty to use the default.</p>
  <textarea
    class="prompt-textarea"
    bind:value={promptText}
    placeholder="e.g. Answer in Russian. Focus on mathematical proofs..."
  ></textarea>
  <div class="prompt-buttons">
    <button class="prompt-btn prompt-btn-primary" onclick={handleSave}>Save</button>
    <button class="prompt-btn" onclick={onClose}>Cancel</button>
  </div>
  <button class="prompt-view-btn" onclick={toggleFullPrompt}>
    {showFullPrompt ? 'Hide full prompt' : 'View full system prompt'}
  </button>
  {#if showFullPrompt}
    <div class="prompt-viewer">
      <pre class="prompt-viewer-text">{fullPromptText}</pre>
    </div>
  {/if}
</Modal>

<style>
  .prompt-view-btn {
    display: block;
    margin-top: 12px;
    background: none;
    border: none;
    color: var(--m-accent);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .prompt-viewer {
    margin-top: 12px;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--m-border-light);
    border-radius: 6px;
    background: var(--m-code-bg);
  }

  .prompt-viewer-text {
    padding: 12px;
    font-size: 11px;
    color: var(--m-fg-muted);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
</style>
