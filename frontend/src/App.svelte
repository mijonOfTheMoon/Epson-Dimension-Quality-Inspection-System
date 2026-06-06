<script lang="ts">
  import { onMount } from 'svelte';
  import { Router, Route } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import ProtectedPage from '$lib/components/ProtectedPage.svelte';
  import LazyRoute from '$lib/components/LazyRoute.svelte';

  const loadLoginPage = () => import('./routes/LoginPage.svelte');
  const loadDashboardPage = () => import('./routes/DashboardPage.svelte');
  const loadLiveTrackingPage = () => import('./routes/LiveTrackingPage.svelte');
  const loadHistoryPage = () => import('./routes/HistoryPage.svelte');
  const loadQualityTrackingPage = () => import('./routes/QualityTrackingPage.svelte');
  const loadPartConfigurationPage = () => import('./routes/PartConfigurationPage.svelte');
  const loadPartEditorPage = () => import('./routes/PartEditorPage.svelte');
  const loadUserManagementPage = () => import('./routes/UserManagementPage.svelte');
  const loadUserEditorPage = () => import('./routes/UserEditorPage.svelte');

  let { url = '' }: { url?: string } = $props();

  onMount(() => {
    theme.init();
    void auth.init();
  });
</script>

<Router {url}>
  <Route path="/login"><LazyRoute loader={loadLoginPage} /></Route>
  <Route path="/"><ProtectedPage><LazyRoute loader={loadDashboardPage} /></ProtectedPage></Route>
  <Route path="/dashboard"><ProtectedPage><LazyRoute loader={loadDashboardPage} /></ProtectedPage></Route>
  <Route path="/live-tracking"><ProtectedPage><LazyRoute loader={loadLiveTrackingPage} /></ProtectedPage></Route>
  <Route path="/history"><ProtectedPage><LazyRoute loader={loadHistoryPage} /></ProtectedPage></Route>
  <Route path="/quality-tracking"><ProtectedPage><LazyRoute loader={loadQualityTrackingPage} /></ProtectedPage></Route>
  <Route path="/part-configuration/new"><ProtectedPage><LazyRoute loader={loadPartEditorPage} /></ProtectedPage></Route>
  <Route path="/part-configuration/:id/edit" let:params><ProtectedPage><LazyRoute loader={loadPartEditorPage} id={params.id} /></ProtectedPage></Route>
  <Route path="/part-configuration"><ProtectedPage><LazyRoute loader={loadPartConfigurationPage} /></ProtectedPage></Route>
  <Route path="/user-management/new"><ProtectedPage><LazyRoute loader={loadUserEditorPage} /></ProtectedPage></Route>
  <Route path="/user-management/:id/edit" let:params><ProtectedPage><LazyRoute loader={loadUserEditorPage} id={params.id} /></ProtectedPage></Route>
  <Route path="/user-management"><ProtectedPage><LazyRoute loader={loadUserManagementPage} /></ProtectedPage></Route>
</Router>
