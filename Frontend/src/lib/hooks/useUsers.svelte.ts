import type { User } from '$lib/types/api';
import { api, getErrorMessage } from '$lib/services/api';

export function useUsers() {
  let data = $state<User[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let version = $state(0);

  $effect(() => {
    void version;
    let active = true;
    loading = true;
    api.getUsers()
      .then((next) => { if (active) { data = next; error = null; } })
      .catch((err) => { if (active) error = getErrorMessage(err); })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; },
    reload() { version += 1; },
  };
}
