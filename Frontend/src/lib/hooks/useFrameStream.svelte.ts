import { subscribeFrames } from '$lib/services/frame-stream';

export function useFrameStream(getStationIds: () => string[]) {
  let frames = $state<Record<string, string>>({});
  const urls = new Map<string, string>();

  $effect(() => {
    const ids = getStationIds();
    const unsubscribers = ids.map((stationId) =>
      subscribeFrames(stationId, (id, blob) => {
        const next = URL.createObjectURL(blob);
        const previous = urls.get(id);
        urls.set(id, next);
        frames = { ...frames, [id]: next };
        if (previous) URL.revokeObjectURL(previous);
      })
    );

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      frames = {};
    };
  });

  return {
    get frames() { return frames; },
  };
}
