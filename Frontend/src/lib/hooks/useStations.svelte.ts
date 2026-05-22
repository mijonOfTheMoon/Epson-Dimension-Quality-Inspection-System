import type { StationStatusEvent } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useStations() {
  let data = $state<StationStatusEvent[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let version = $state(0);

  $effect(() => {
    void version;
    let active = true;
    loading = true;
    api.getStations()
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });

    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'station.status') return;
      const withoutCurrent = data.filter((item) => item.stationId !== event.stationId);
      data = [event, ...withoutCurrent].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
