<script lang="ts">
  import { appStatus } from '../state/app-status.svelte';
</script>

{#if appStatus.toasts.length > 0}
  <div class="toast-container">
    {#each appStatus.toasts as toast (toast.id)}
      <div class="toast toast-{toast.severity}">
        <span class="toast-msg">{toast.message}</span>
        <div class="toast-actions">
          {#if toast.onRetry}
            <button class="toast-btn" onclick={toast.onRetry}>Retry</button>
          {/if}
          <button class="toast-btn toast-dismiss" onclick={() => appStatus.dismiss(toast.id)}>&#x2715;</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 400px;
  }
  @media (max-width: 500px) {
    .toast-container {
      bottom: auto;
      top: 8px;
      right: 8px;
      left: 8px;
      max-width: none;
    }
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    background: var(--m-bg-1);
    color: var(--m-fg);
    border-left: 4px solid var(--m-fg-dim);
    box-shadow: 0 4px 16px var(--m-shadow);
  }
  .toast-info { border-left-color: #83a598; }
  .toast-warning { border-left-color: #fabd2f; }
  .toast-error { border-left-color: #fb4934; }
  .toast-fatal { border-left-color: #fb4934; background: #3c1111; }
  .toast-msg { flex: 1; }
  .toast-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .toast-btn {
    background: none;
    border: 1px solid var(--m-border-light);
    color: var(--m-fg-muted);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .toast-dismiss { border: none; font-size: 14px; padding: 2px 4px; }
</style>
