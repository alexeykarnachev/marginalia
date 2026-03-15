<script lang="ts">
  import { SYSTEM_PROMPT, renderPrompt } from '../core/prompt';
  import { getBookPrompt, setBookPrompt } from '../state/settings.svelte';
  import { buildLibraryContext } from '../core/tools';

  let {
    open,
    bookId,
    onClose,
  }: {
    open: boolean;
    bookId: string;
    onClose: () => void;
  } = $props();

  let promptText = $state('');
  let showFullPrompt = $state(false);
  let fullPromptText = $state('');

  $effect(() => {
    if (open) {
      promptText = getBookPrompt(bookId);
      showFullPrompt = false;
      fullPromptText = '';
    }
  });

  function handleSave() {
    setBookPrompt(bookId, promptText.trim());
    onClose();
  }

  function handleCancel() {
    onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function toggleFullPrompt() {
    if (showFullPrompt) {
      showFullPrompt = false;
      return;
    }
    const context = await buildLibraryContext();
    let system = renderPrompt(SYSTEM_PROMPT, context as unknown as Record<string, string>);
    const bp = getBookPrompt(bookId);
    if (bp) system += '\n\n## Book-specific instructions (MUST FOLLOW)\n' + bp;
    fullPromptText = system;
    showFullPrompt = true;
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
      <h3>System prompt for this book</h3>
      <p class="prompt-hint">This text is appended to the base system prompt. Leave empty to use the default.</p>
      <textarea
        class="prompt-textarea"
        bind:value={promptText}
        placeholder="e.g. Answer in Russian. Focus on mathematical proofs..."
      ></textarea>
      <div class="prompt-buttons">
        <button class="prompt-btn prompt-btn-primary" onclick={handleSave}>Save</button>
        <button class="prompt-btn" onclick={handleCancel}>Cancel</button>
      </div>
      <button class="prompt-view-btn" onclick={toggleFullPrompt}>
        {showFullPrompt ? 'Hide full prompt' : 'View full system prompt'}
      </button>
      {#if showFullPrompt}
        <div class="prompt-viewer">
          <pre class="prompt-viewer-text">{fullPromptText}</pre>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .prompt-overlay {
    position: fixed;
    inset: 0;
    background: var(--m-overlay-bg);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .prompt-modal {
    background: var(--m-bg-0);
    border: 1px solid var(--m-border);
    border-radius: 12px;
    padding: 24px;
    width: 90%;
    max-width: 560px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px var(--m-shadow);
  }

  .prompt-modal h3 {
    margin: 0 0 8px;
    color: var(--m-fg);
    font-size: 16px;
  }

  .prompt-hint {
    color: var(--m-fg-muted);
    font-size: 12px;
    margin: 0 0 12px;
  }

  .prompt-textarea {
    width: 100%;
    min-height: 120px;
    background: var(--m-input-bg);
    color: var(--m-fg);
    border: 1px solid var(--m-border-light);
    border-radius: 6px;
    padding: 10px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    box-sizing: border-box;
  }

  .prompt-buttons {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .prompt-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--m-border-light);
    background: var(--m-bg-1);
    color: var(--m-fg);
    cursor: pointer;
    font-size: 13px;
  }
  .prompt-btn:hover {
    background: var(--m-bg-2);
  }

  .prompt-btn-primary {
    background: var(--m-accent);
    color: var(--m-bg-0);
    border-color: var(--m-accent);
  }
  .prompt-btn-primary:hover {
    background: var(--m-accent-hover);
  }

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
