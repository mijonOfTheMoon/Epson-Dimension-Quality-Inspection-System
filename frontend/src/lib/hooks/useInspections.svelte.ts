import { onMount } from 'svelte';
import type { InspectionResult } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { createPollingBackoff } from '$lib/services/backoff';
import { startVisibilityPolling, deepEqual } from '$lib/services/polling';

const inspectionsCache = new Map<string, InspectionResult[]>();

export function useInspections(limit = 200, visibleMs = 3000, hiddenMs = 15000, includeDetections = false) {
  const cacheKey = `${limit}|${includeDetections}`;
  let data = $state<InspectionResult[]>(inspectionsCache.get(cacheKey) ?? []);
  let loading = $state(!inspectionsCache.has(cacheKey));
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;
  let inFlight = false;
  const backoff = createPollingBackoff();

  const load = async (showLoading = true) => {
    if (!mounted) return;
    if (inFlight) return;
    if (!showLoading && !backoff.canRequest()) return;
    inFlight = true;
    const current = ++requestId;
    if (showLoading && !inspectionsCache.has(cacheKey)) loading = true;
    try {
      const next = await api.getInspections({ limit, includeDetections });
      if (!mounted || current !== requestId) return;
      if (!deepEqual(data, next)) data = next;
      inspectionsCache.set(cacheKey, next);
      error = null;
      backoff.reset();
    } catch (err) {
      backoff.recordFailure(err);
      if (mounted && current === requestId && showLoading) error = getErrorMessage(err);
    } finally {
      inFlight = false;
      if (mounted && current === requestId && (showLoading || loading)) loading = false;
    }
  };

  const refresh = () => load(false);

  onMount(() => {
    mounted = true;
    void load();
    const stopPolling = startVisibilityPolling(refresh, visibleMs, hiddenMs);

    return () => {
      mounted = false;
      requestId += 1;
      stopPolling();
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
  };
}
