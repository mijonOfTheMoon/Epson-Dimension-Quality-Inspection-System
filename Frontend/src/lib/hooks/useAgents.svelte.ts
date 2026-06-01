import { onMount } from 'svelte';
import type { AgentInfo } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { startVisibilityPolling } from '$lib/services/polling';

export function useAgents() {
  let data = $state<AgentInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;

  const load = async (showLoading = true) => {
    if (!mounted) return;
    const current = ++requestId;
    if (showLoading) loading = true;
    try {
      const next = await api.getAgents();
      if (mounted && current === requestId) {
        data = next;
        error = null;
      }
    } catch (err) {
      if (mounted && current === requestId && showLoading) error = getErrorMessage(err);
    } finally {
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
