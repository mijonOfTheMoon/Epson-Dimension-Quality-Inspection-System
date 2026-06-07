import { onMount } from 'svelte';
import type { PartType } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';

let partsCache: PartType[] | null = null;

export function useParts() {
  let data = $state<PartType[]>(partsCache ?? []);
  let loading = $state(partsCache === null);
  let error = $state<string | null>(null);
  let mounted = false;
  let requestId = 0;

  const load = async () => {
    if (!mounted) return;
    const current = ++requestId;
    if (partsCache === null) loading = true;
    try {
      const next = await api.getParts();
      if (mounted && current === requestId) {
        data = next;
        partsCache = next;
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
