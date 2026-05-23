<script lang="ts">
  import type { Snippet } from 'svelte';
  import RequireAuth from './RequireAuth.svelte';
  import Layout from './Layout.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<RequireAuth>
  <Layout>
    {@render children()}
  </Layout>
</RequireAuth>
