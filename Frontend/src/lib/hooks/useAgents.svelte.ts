import type { AgentInfo } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';
import { subscribeRealtime } from '$lib/services/realtime';

export function useAgents() {
  let data = $state<AgentInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let version = $state(0);

  const refresh = async () => {
    try {
      const next = await api.getAgents();
      data = next;
      error = null;
    } catch (err) {
      error = getErrorMessage(err);
    }
  };

  $effect(() => {
    void version;
    let active = true;
    loading = true;
    api.getAgents()
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  $effect(() => {
    let throttled = false;
    const unsubscribe = subscribeRealtime((event) => {
      if (event.eventType !== 'station.status') return;
      if (throttled) return;
      throttled = true;
      window.setTimeout(() => {
        throttled = false;
        void refresh();
      }, 500);
    });
    return unsubscribe;
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { version += 1; },
    refresh,
  };
}
