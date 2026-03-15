<script lang="ts">
  import { getCompactPrompt, setCompactPrompt } from '../state/settings.svelte';
  import { DEFAULT_COMPACT_PROMPT } from '../core/compact';

  let {
    open,
    bookId,
    onClose,
    onCompact,
  }: {
    open: boolean;
    bookId: string;
    onClose: () => void;
    onCompact: () => void;
  } = $props();

  let promptText = $state('');

  $effect(() => {
    if (open) {
      promptText = getCompactPrompt(bookId) || DEFAULT_COMPACT_PROMPT;
    }
  });

  function handleCompact() {
    // Don't store the default — only store custom prompts
    const isDefault = promptText.trim() === DEFAULT_COMPACT_PROMPT.trim();
    setCompactPrompt(bookId, isDefault ? '' : promptText);
    onCompact();
    onClose();
  }

  function handleReset() {
    promptText = DEFAULT_COMPACT_PROMPT;
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
      <h3>Compact conversation</h3>
      <p class="prompt-hint">The model will summarize the entire conversation using this prompt, then replace all messages with the summary.</p>
      <textarea
        class="prompt-textarea"
        bind:value={promptText}
      ></textarea>
      <div class="prompt-buttons">
        <button class="prompt-btn prompt-btn-primary" onclick={handleCompact}>Compact now</button>
        <button class="prompt-btn" onclick={onClose}>Cancel</button>
        <button class="prompt-btn prompt-btn-reset" onclick={handleReset}>Reset prompt</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .prompt-btn-reset {
    margin-left: auto;
    color: var(--m-fg-muted);
    font-size: 12px;
  }
</style>
