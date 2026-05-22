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
  let version = $state(0);

  $effect(() => {
    void version;
    let active = true;
    let timer: number | undefined;
    loading = true;
    api.getDashboardSummary()
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });

    const scheduleRefresh = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!active) return;
        api.getDashboardSummary()
          .then((next) => { if (active) data = next; })
          .catch(() => undefined);
      }, REFRESH_DEBOUNCE_MS);
    };

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType === 'inspection.created') scheduleRefresh();
    });

    return () => {
      active = false;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { version += 1; },
  };
}
