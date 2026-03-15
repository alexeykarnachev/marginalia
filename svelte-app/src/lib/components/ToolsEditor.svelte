<script lang="ts">
  import { getAllTools, setToolEnabled } from '../core/tools';

  let {
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let tools = $state<{ name: string; description: string; enabled: boolean }[]>([]);

  $effect(() => {
    if (open) {
      tools = getAllTools();
    }
  });

  function handleToggle(name: string, enabled: boolean) {
    setToolEnabled(name, enabled);
    // Update local state
    tools = tools.map(t => t.name === name ? { ...t, enabled } : t);
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
  <div class="tools-overlay" onclick={handleBackdropClick}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tools-modal" onclick={(e) => e.stopPropagation()}>
      <h3>Agent tools</h3>
      <p class="tools-hint">Toggle tools the AI agent can use. Disabled tools won't be offered to the model.</p>
      <div class="tools-list">
        {#each tools as tool}
          <label class="tool-row">
            <input
              type="checkbox"
              checked={tool.enabled}
              onchange={(e) => handleToggle(tool.name, (e.target as HTMLInputElement).checked)}
            />
            <div class="tool-info">
              <strong>{tool.name}</strong>
              <span>{tool.description}</span>
            </div>
          </label>
        {/each}
      </div>
      <div class="tools-buttons">
        <button class="tools-btn" onclick={onClose}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .tools-overlay {
    position: fixed;
    inset: 0;
    background: var(--m-overlay-bg);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tools-modal {
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

  .tools-modal h3 {
    margin: 0 0 8px;
    color: var(--m-fg);
    font-size: 16px;
  }

  .tools-hint {
    color: var(--m-fg-muted);
    font-size: 12px;
    margin: 0 0 12px;
  }

  .tools-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .tool-row:hover {
    background: var(--m-bg-1);
  }

  .tool-row input[type="checkbox"] {
    margin-top: 3px;
    flex-shrink: 0;
  }

  .tool-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tool-info strong {
    font-size: 13px;
    color: var(--m-fg);
  }
  .tool-info span {
    font-size: 11px;
    color: var(--m-fg-muted);
    line-height: 1.3;
  }

  .tools-buttons {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }

  .tools-btn {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--m-border-light);
    background: var(--m-bg-1);
    color: var(--m-fg);
    cursor: pointer;
    font-size: 13px;
  }
  .tools-btn:hover {
    background: var(--m-bg-2);
  }
</style>
