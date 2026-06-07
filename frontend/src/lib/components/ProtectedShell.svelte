<script lang="ts">
  import type { Component } from 'svelte';
  import { useLocation } from 'svelte-routing';
  import RequireAuth from './RequireAuth.svelte';
  import Layout from './Layout.svelte';
  import LazyRoute from './LazyRoute.svelte';

  type LoaderFn = () => Promise<{ default: Component<any> }>;
  interface RouteMatch {
    loader: LoaderFn;
    props: Record<string, unknown>;
  }

  const loadDashboardPage = () => import('../../routes/DashboardPage.svelte');
  const loadLiveTrackingPage = () => import('../../routes/LiveTrackingPage.svelte');
  const loadHistoryPage = () => import('../../routes/HistoryPage.svelte');
  const loadQualityTrackingPage = () => import('../../routes/QualityTrackingPage.svelte');
  const loadPartConfigurationPage = () => import('../../routes/PartConfigurationPage.svelte');
  const loadPartEditorPage = () => import('../../routes/PartEditorPage.svelte');
  const loadUserManagementPage = () => import('../../routes/UserManagementPage.svelte');
  const loadUserEditorPage = () => import('../../routes/UserEditorPage.svelte');

  const location = useLocation();

  const route = $derived.by<RouteMatch>(() => {
    const path = $location.pathname.replace(/\/+$/, '') || '/';
    let matched: RegExpMatchArray | null;
    if ((matched = path.match(/^\/part-configuration\/([^/]+)\/edit$/))) {
      return { loader: loadPartEditorPage, props: { id: matched[1] } };
    }
    if (path === '/part-configuration/new') return { loader: loadPartEditorPage, props: {} };
    if (path === '/part-configuration') return { loader: loadPartConfigurationPage, props: {} };
    if ((matched = path.match(/^\/user-management\/([^/]+)\/edit$/))) {
      return { loader: loadUserEditorPage, props: { id: matched[1] } };
    }
    if (path === '/user-management/new') return { loader: loadUserEditorPage, props: {} };
    if (path === '/user-management') return { loader: loadUserManagementPage, props: {} };
    if (path === '/live-tracking') return { loader: loadLiveTrackingPage, props: {} };
    if (path === '/history') return { loader: loadHistoryPage, props: {} };
    if (path === '/quality-tracking') return { loader: loadQualityTrackingPage, props: {} };
    return { loader: loadDashboardPage, props: {} };
  });
</script>

<RequireAuth>
  <Layout>
    <LazyRoute loader={route.loader} {...route.props} />
  </Layout>
</RequireAuth>
