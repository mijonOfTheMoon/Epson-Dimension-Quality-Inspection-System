<script lang="ts">
  import type { Component } from 'svelte';
  import Notice from './Notice.svelte';

  type LoadedModule = { default: Component<any> };

  let {
    loader,
    ...rest
  }: {
    loader: () => Promise<LoadedModule>;
    [key: string]: unknown;
  } = $props();

  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let LoadedComponent = $state<Component<any> | null>(null);

  async function load() {
    status = 'loading';
    LoadedComponent = null;
    try {
      const module = await loader();
      LoadedComponent = module.default;
      status = 'ready';
    } catch {
      status = 'error';
    }
  }

  $effect(() => {
    void load();
  });
</script>

{#if status === 'loading'}
  <div
    class="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)] text-sm"
    role="status"
    aria-live="polite"
  >
    <span
      class="mr-3 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent"
      aria-hidden="true"
    ></span>
    Memuat halaman...
  </div>
{:else if status === 'error'}
  <div class="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] p-6">
    <div class="w-full max-w-sm">
      <Notice text="Gagal memuat halaman" tone="error" />
    </div>
    <button
      type="button"
      class="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
      onclick={() => void load()}
    >
      Coba lagi
    </button>
  </div>
{:else if status === 'ready' && LoadedComponent}
  {@const Loaded = LoadedComponent}
  <Loaded {...rest} />
{/if}
