<script lang="ts">
  import { subscribeFrames } from '$lib/services/frame-stream';

  let {
    stationId,
    className = '',
    alt,
  }: {
    stationId: string;
    className?: string;
    alt?: string;
  } = $props();

  let frameUrl = $state<string | null>(null);
  let previousUrl: string | null = null;

  $effect(() => {
    const unsubscribe = subscribeFrames(stationId, (_id, blob) => {
      const next = URL.createObjectURL(blob);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = next;
      frameUrl = next;
    });
    return () => {
      unsubscribe();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = null;
      frameUrl = null;
    };
  });
</script>

{#if frameUrl}
  <img src={frameUrl} alt={alt ?? `Station ${stationId} live`} class="w-full h-full object-contain {className}" />
{:else}
  <div class="text-gray-500 text-xs flex flex-col items-center justify-center h-full w-full">
    Menunggu frame...
  </div>
{/if}
