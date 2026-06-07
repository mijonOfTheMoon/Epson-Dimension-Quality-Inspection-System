<script lang="ts">
  import { onMount } from 'svelte';
  import { Router, Route } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import ProtectedShell from '$lib/components/ProtectedShell.svelte';
  import LazyRoute from '$lib/components/LazyRoute.svelte';

  const loadLoginPage = () => import('./routes/LoginPage.svelte');

  let { url = '' }: { url?: string } = $props();

  onMount(() => {
    theme.init();
    void auth.init();
  });
</script>

<Router {url}>
  <Route path="/login"><LazyRoute loader={loadLoginPage} /></Route>
  <Route path="/*"><ProtectedShell /></Route>
</Router>
