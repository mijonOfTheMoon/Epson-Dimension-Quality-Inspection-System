<script lang="ts">
  import { onMount } from 'svelte';
  import { Router, Route } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import ProtectedPage from '$lib/components/ProtectedPage.svelte';
  import LoginPage from './routes/LoginPage.svelte';
  import DashboardPage from './routes/DashboardPage.svelte';
  import LiveTrackingPage from './routes/LiveTrackingPage.svelte';
  import HistoryPage from './routes/HistoryPage.svelte';
  import QualityTrackingPage from './routes/QualityTrackingPage.svelte';
  import PartConfigurationPage from './routes/PartConfigurationPage.svelte';
  import UserManagementPage from './routes/UserManagementPage.svelte';

  let { url = '' }: { url?: string } = $props();

  onMount(() => {
    theme.init();
    void auth.init();
  });
</script>

<Router {url}>
  <Route path="/login"><LoginPage /></Route>
  <Route path="/"><ProtectedPage><DashboardPage /></ProtectedPage></Route>
  <Route path="/dashboard"><ProtectedPage><DashboardPage /></ProtectedPage></Route>
  <Route path="/live-tracking"><ProtectedPage><LiveTrackingPage /></ProtectedPage></Route>
  <Route path="/history"><ProtectedPage><HistoryPage /></ProtectedPage></Route>
  <Route path="/quality-tracking"><ProtectedPage><QualityTrackingPage /></ProtectedPage></Route>
  <Route path="/part-configuration"><ProtectedPage><PartConfigurationPage /></ProtectedPage></Route>
  <Route path="/user-management"><ProtectedPage><UserManagementPage /></ProtectedPage></Route>
</Router>
