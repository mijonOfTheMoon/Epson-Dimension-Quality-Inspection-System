<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import {
    LayoutDashboard, History, AlertTriangle, LogOut, Menu, Video,
    ChevronUp, Moon, Sun, Package, Users,
  } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import type { UserRole } from '$lib/types/api';
  import Logo from '../../assets/Logo.png';

  let { children }: { children: Snippet } = $props();

  let sidebarOpen = $state(false);
  let userMenuOpen = $state(false);

  const roleLabels: Record<string, string> = {
    operator: 'Operator QC',
    qc: 'Quality Control',
    supervisor: 'Supervisor',
    engineering: 'Engineering',
    admin: 'Admin Sistem',
    vendor: 'Vendor',
  };

  type NavItem = { to: string; icon: typeof LayoutDashboard; label: string; roles: UserRole[] };
  const navItems: NavItem[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/live-tracking', icon: Video, label: 'Live Tracking', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/history', icon: History, label: 'Riwayat Inspeksi', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/quality-tracking', icon: AlertTriangle, label: 'Quality Tracking', roles: ['engineering', 'supervisor', 'vendor', 'admin'] },
    { to: '/part-configuration', icon: Package, label: 'Konfigurasi Part', roles: ['engineering', 'admin'] },
    { to: '/user-management', icon: Users, label: 'Manajemen User', roles: ['admin'] },
  ];

  const visibleItems = $derived(navItems.filter((item) => item.roles.some((role) => auth.hasRole(role))));

  const handleLogout = async () => {
    await auth.logout();
    navigate('/login', { replace: true });
  };

  type LinkPropsFn = (params: { isCurrent: boolean; location: { pathname: string } }) => { class: string };

  const linkPropsMap: Record<string, LinkPropsFn> = {};
  for (const item of navItems) {
    linkPropsMap[item.to] = ({ isCurrent, location }) => {
      const isDashboardRoot = item.to === '/dashboard' && location.pathname === '/';
      const active = isCurrent || isDashboardRoot;
      return {
        class: `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'}`,
      };
    };
  }
</script>

<div class="flex h-screen bg-[var(--background)]">
  <aside class="fixed inset-y-0 left-0 z-40 w-64 bg-[#0f172a] text-white transform transition-transform lg:translate-x-0 lg:static {sidebarOpen ? 'translate-x-0' : '-translate-x-full'}">
    <div class="flex items-center gap-3 px-5 py-5 border-b border-white/10">
      <div class="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center overflow-hidden">
        <img src={Logo} alt="Logo" class="w-full h-full object-cover" />
      </div>
      <div>
        <div class="text-sm tracking-wide" style="font-weight: 500">DimInspect</div>
        <div class="text-[11px] text-blue-300">Quality Monitoring</div>
      </div>
    </div>

    <nav class="mt-4 px-3 space-y-1">
      {#each visibleItems as item (item.to)}
        {@const Icon = item.icon}
        <Link to={item.to} getProps={linkPropsMap[item.to]}>
          <Icon class="w-[18px] h-[18px]" />
          {item.label}
        </Link>
      {/each}
    </nav>

    <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
      {#if userMenuOpen}
        <div class="mb-3 rounded-xl bg-white/10 p-2 text-sm shadow-lg">
          <button onclick={() => theme.toggle()} class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-gray-200 hover:bg-white/10 hover:text-white">
            {#if theme.mode === 'dark'}
              <Sun class="w-4 h-4" /> Mode terang
            {:else}
              <Moon class="w-4 h-4" /> Mode gelap
            {/if}
          </button>
          <button onclick={handleLogout} class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-gray-200 hover:bg-white/10 hover:text-white">
            <LogOut class="w-4 h-4" /> Keluar
          </button>
        </div>
      {/if}
      <button onclick={() => userMenuOpen = !userMenuOpen} class="flex w-full items-center gap-3 rounded-xl p-2 hover:bg-white/10 text-left">
        <div class="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center text-sm">
          {auth.user?.name?.charAt(0) ?? ''}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate">{auth.user?.name ?? ''}</div>
          <div class="text-[11px] text-gray-400">{roleLabels[auth.user?.role ?? ''] ?? ''}</div>
        </div>
        <ChevronUp class="w-4 h-4 text-gray-400 transition-transform {userMenuOpen ? '' : 'rotate-180'}" />
      </button>
    </div>
  </aside>

  {#if sidebarOpen}
    <button class="fixed inset-0 bg-black/50 z-30 lg:hidden" onclick={() => sidebarOpen = false} aria-label="Tutup sidebar"></button>
  {/if}

  <div class="flex-1 flex flex-col min-w-0">
    <header class="h-14 border-b border-[var(--border)] flex items-center justify-between px-4 bg-[var(--card)] shrink-0">
      <button class="lg:hidden p-1.5 hover:bg-[var(--accent)] rounded-md" onclick={() => sidebarOpen = true} aria-label="Buka sidebar">
        <Menu class="w-5 h-5" />
      </button>
      <div class="flex-1"></div>
    </header>
    <main class="flex-1 overflow-y-auto p-4 lg:p-6">
      {@render children()}
    </main>
  </div>
</div>
