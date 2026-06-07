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

  async function load(current: () => Promise<LoadedModule>) {
    try {
      const module = await current();
      if (current !== loader) return;
      LoadedComponent = module.default;
      status = 'ready';
    } catch {
      if (current !== loader) return;
      status = 'error';
    }
  }

  $effect(() => {
    const current = loader;
    if (LoadedComponent === null) status = 'loading';
    void load(current);
  });
</script>

{#if status === 'error'}
  <div class="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6">
    <div class="w-full max-w-sm">
      <Notice text="Gagal memuat halaman" tone="error" />
    </div>
    <button
      type="button"
      class="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--muted)]"
      onclick={() => void load(loader)}
    >
      Coba lagi
    </button>
  </div>
{:else if LoadedComponent}
  {@const Loaded = LoadedComponent}
  <Loaded {...rest} />
{:else}
  <div
    class="flex min-h-[60vh] items-center justify-center text-[var(--muted-foreground)] text-sm"
    role="status"
    aria-live="polite"
  >
    <span
      class="mr-3 inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent"
      aria-hidden="true"
    ></span>
    Memuat halaman...
  </div>
{/if}
