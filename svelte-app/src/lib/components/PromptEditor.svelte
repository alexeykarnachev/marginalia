<script lang="ts">
  import { SYSTEM_PROMPT, renderPrompt } from '../core/prompt';
  import { getBookPrompt, setBookPrompt } from '../state/settings.svelte';
  import { buildLibraryContext } from '../core/tools';

  let {
    open,
    bookId,
    summary = null,
    onClose,
  }: {
    open: boolean;
    bookId: string;
    summary?: string | null;
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
    if (summary) system += '\n\n## Previous conversation summary\n' + summary;
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
