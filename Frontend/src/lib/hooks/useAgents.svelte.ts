import { onMount } from 'svelte';
import type { AgentInfo } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useAgents() {
  let data = $state<AgentInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;
  let refreshTimer: number | undefined;

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

  const scheduleRefresh = () => {
    if (!mounted || refreshTimer !== undefined) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 500);
  };

  onMount(() => {
    mounted = true;
    void load();
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'station.status') return;
      scheduleRefresh();
    });
    return () => {
      mounted = false;
      requestId += 1;
      unsubscribe();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
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
