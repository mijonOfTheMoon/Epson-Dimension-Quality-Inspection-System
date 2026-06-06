import { onMount } from 'svelte';
import type { AgentInfo } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { createPollingBackoff } from '$lib/services/backoff';
import { startVisibilityPolling, deepEqual } from '$lib/services/polling';

export function useAgents() {
  let data = $state<AgentInfo[]>([]);
  let loading = $state(true);
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
    if (showLoading) loading = true;
    try {
      const next = await api.getAgents();
      if (mounted && current === requestId) {
        if (!deepEqual(data, next)) data = next;
        error = null;
        backoff.reset();
      }
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
    const stopPolling = startVisibilityPolling(refresh, 3000, 15000);
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
    refresh,
  };
}
