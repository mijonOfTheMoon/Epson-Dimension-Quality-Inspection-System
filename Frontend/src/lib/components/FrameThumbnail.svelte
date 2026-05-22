<script lang="ts">
  import { api } from '$lib/services/api';

  let {
    eventId,
    initialUrl,
    className = '',
    alt,
  }: {
    eventId: string;
    initialUrl: string;
    className?: string;
    alt?: string;
  } = $props();

  let refreshedUrl = $state<string | null>(null);
  let attempted = $state(false);
  let failed = $state(false);

  const src = $derived(refreshedUrl ?? initialUrl);

  $effect.pre(() => {
    void initialUrl;
    refreshedUrl = null;
    attempted = false;
    failed = false;
  });

  const handleError = async () => {
    if (attempted) {
      failed = true;
      return;
    }
    attempted = true;
    try {
      const { frameUrl } = await api.refreshFrameUrl(eventId);
      refreshedUrl = frameUrl;
    } catch {
      failed = true;
    }
  };
</script>

{#if failed}
  <div class="text-xs text-[var(--muted-foreground)] py-6 text-center border border-dashed border-[var(--border)] rounded-lg">
    Frame tidak tersedia
  </div>
{:else}
  <img
    {src}
    onerror={handleError}
    loading="lazy"
    alt={alt ?? `Frame inspeksi ${eventId}`}
    class="rounded-lg border border-[var(--border)] {className}"
  />
{/if}
