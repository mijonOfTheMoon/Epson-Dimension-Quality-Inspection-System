import { onMount } from 'svelte';
import type { InspectionResult } from '$lib/types/api';
import { api, getErrorMessage, normalizeInspectionEvent } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useInspections(limit = 1000) {
  let data = $state<InspectionResult[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;
  const ids = new Set<string>();

  const load = async () => {
    if (!mounted) return;
    const current = ++requestId;
    loading = true;
    try {
      const next = await api.getInspections({ limit });
      if (!mounted || current !== requestId) return;
      data = next;
      ids.clear();
      for (const item of next) ids.add(item.id);
      error = null;
    } catch (err) {
      if (mounted && current === requestId) error = getErrorMessage(err);
    } finally {
      if (mounted && current === requestId) loading = false;
    }
  };

  onMount(() => {
    mounted = true;
    void load();
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'inspection.created') return;
      const next = normalizeInspectionEvent(event);
      if (ids.has(next.id)) return;
      ids.add(next.id);
      const merged = [next, ...data];
      if (merged.length > limit) {
        const dropped = merged.splice(limit);
        for (const item of dropped) ids.delete(item.id);
      }
      data = merged;
      error = null;
    });

    return () => {
      mounted = false;
      requestId += 1;
      ids.clear();
      unsubscribe();
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
  };
}
