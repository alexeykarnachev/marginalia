<script lang="ts">
  import { getAllTools, setToolEnabled } from '../core/tools';
  import Modal from './Modal.svelte';

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
    tools = tools.map(t => t.name === name ? { ...t, enabled } : t);
  }
</script>

<Modal {open} {onClose}>
  <h3>Agent tools</h3>
  <p class="prompt-hint">Toggle tools the AI agent can use. Disabled tools won't be offered to the model.</p>
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
  <div class="prompt-buttons">
    <button class="prompt-btn" onclick={onClose}>Close</button>
  </div>
</Modal>

<style>
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
  @media (hover: hover) {
    .tool-row:hover {
      background: var(--m-bg-1);
    }
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
</style>
