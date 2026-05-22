<script lang="ts">
  import type { Snippet } from 'svelte';
  import { navigate } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    if (auth.status === 'unauthenticated') {
      navigate('/login', { replace: true });
    }
  });
</script>

{#if auth.status === 'loading'}
  <div class="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)] text-sm">
    Memuat sesi...
  </div>
{:else if auth.status === 'authenticated'}
  {@render children()}
{/if}
