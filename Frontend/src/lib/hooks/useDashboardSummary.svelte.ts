import { onMount } from 'svelte';
import type { DashboardSummary } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

const EMPTY: DashboardSummary = {
  total: 0,
  ok: 0,
  ng: 0,
  ngRate: 0,
  dailyTrend: [],
  stationCount: 0,
  activeStationCount: 0,
  stationTrend: [],
  partPareto: [],
  measurementDrift: [],
};

const REFRESH_DEBOUNCE_MS = 500;

export function useDashboardSummary() {
  let data = $state<DashboardSummary>(EMPTY);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;
  let timer: number | undefined;

  const load = async (showLoading = true) => {
    if (!mounted) return;
    const current = ++requestId;
    if (showLoading) loading = true;
    try {
      const next = await api.getDashboardSummary();
      if (mounted && current === requestId) {
        data = next;
        if (showLoading) error = null;
      }
    } catch (err) {
      if (mounted && current === requestId && showLoading) error = getErrorMessage(err);
    } finally {
      if (mounted && current === requestId && (showLoading || loading)) loading = false;
    }
  };

  const scheduleRefresh = () => {
    if (!mounted || timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void load(false);
    }, REFRESH_DEBOUNCE_MS);
  };

  onMount(() => {
    mounted = true;
    void load();
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType === 'inspection.created' || event.eventType === 'station.status') {
        scheduleRefresh();
      }
    });
    return () => {
      mounted = false;
      requestId += 1;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
  };
}
