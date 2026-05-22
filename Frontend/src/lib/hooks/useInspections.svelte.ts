import type { InspectionResult } from '$lib/types/api';
import { api, getErrorMessage, normalizeInspectionEvent } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useInspections(limit = 1000) {
  let data = $state<InspectionResult[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let version = $state(0);

  $effect(() => {
    void version;
    let active = true;
    loading = true;
    api.getInspections({ limit })
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'inspection.created') return;
      const next = normalizeInspectionEvent(event);
      if (data.some((item) => item.id === next.id)) return;
      data = [next, ...data].slice(0, limit);
      error = null;
    });

    return () => { active = false; unsubscribe(); };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { version += 1; },
  };
}
