import { onMount } from 'svelte';
import type { PartType } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';

export function useParts() {
  let data = $state<PartType[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;

  const load = async () => {
    if (!mounted) return;
    const current = ++requestId;
    loading = true;
    try {
      const next = await api.getParts();
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
    return () => {
      mounted = false;
      requestId += 1;
    };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { void load(); },
  };
}
