import { onMount } from 'svelte';
import type { StationStatusEvent } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useStations() {
  let data = $state<StationStatusEvent[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;

  const applyStation = (event: StationStatusEvent) => {
    if (event.isActive === false) {
      data = data.filter((item) => item.stationId !== event.stationId);
      return;
    }
    const withoutCurrent = data.filter((item) => item.stationId !== event.stationId);
    data = [event, ...withoutCurrent].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    error = null;
  };

  const load = async () => {
    if (!mounted) return;
    const current = ++requestId;
    loading = true;
    try {
      const next = await api.getStations();
      if (mounted && current === requestId) {
        data = next;
        error = null;
      }
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
      if (event.eventType !== 'station.status') return;
      applyStation(event);
    });

    return () => {
      mounted = false;
      requestId += 1;
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
