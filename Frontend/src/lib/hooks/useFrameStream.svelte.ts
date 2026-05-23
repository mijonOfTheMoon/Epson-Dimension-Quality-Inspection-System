import { subscribeFrames } from '$lib/services/frame-stream';

export function useFrameStream(getStationIds: () => string[]) {
  let frames = $state<Record<string, string>>({});
  const urls = new Map<string, string>();
  const subs = new Map<string, () => void>();

  const snapshotFrames = () => {
    const out: Record<string, string> = {};
    for (const [id, url] of urls) out[id] = url;
    return out;
  };

  $effect(() => {
    const nextIds = new Set(getStationIds());
    let dirty = false;

    for (const [id, unsub] of subs) {
      if (nextIds.has(id)) continue;
      unsub();
      subs.delete(id);
      const url = urls.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        urls.delete(id);
        dirty = true;
      }
    }

    for (const id of nextIds) {
      if (subs.has(id)) continue;
      const unsub = subscribeFrames(id, (sid, blob) => {
        const next = URL.createObjectURL(blob);
        const previous = urls.get(sid);
        urls.set(sid, next);
        frames = snapshotFrames();
        if (previous) URL.revokeObjectURL(previous);
      });
      subs.set(id, unsub);
    }

    if (dirty) {
      frames = snapshotFrames();
    }
  });

  $effect(() => () => {
    for (const unsub of subs.values()) unsub();
    subs.clear();
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  });

  return {
    get frames() { return frames; },
  };
}
