<script lang="ts">
  import { onMount } from 'svelte';
  import { Router, Route } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import RequireAuth from '$lib/components/RequireAuth.svelte';
  import Layout from '$lib/components/Layout.svelte';
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
  <Route path="/*">
    <RequireAuth>
      <Layout>
        <Route path="/"><DashboardPage /></Route>
        <Route path="/dashboard"><DashboardPage /></Route>
        <Route path="/live-tracking"><LiveTrackingPage /></Route>
        <Route path="/history"><HistoryPage /></Route>
        <Route path="/quality-tracking"><QualityTrackingPage /></Route>
        <Route path="/part-configuration"><PartConfigurationPage /></Route>
        <Route path="/user-management"><UserManagementPage /></Route>
      </Layout>
    </RequireAuth>
  </Route>
</Router>
