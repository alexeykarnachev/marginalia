<script lang="ts">
  import type { Snippet } from 'svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  let {
    title,
    subtitle = '',
    children,
    actions,
  }: {
    title: string;
    subtitle?: string;
    children?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<div class="m-toolbar">
  <div class="m-toolbar-left">
    {#if children}
      {@render children()}
    {/if}
    <span class="m-toolbar-title">{title}</span>
    {#if subtitle}
      <span class="m-toolbar-subtitle">{subtitle}</span>
    {/if}
  </div>
  <div class="m-toolbar-right">
    {#if actions}
      {@render actions()}
    {/if}
    <ThemeToggle />
  </div>
</div>
