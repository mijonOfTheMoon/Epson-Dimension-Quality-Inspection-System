<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Link, navigate } from 'svelte-routing';
  import {
    LayoutDashboard, History, AlertTriangle, LogOut, Menu, Video,
    ChevronUp, Moon, Sun, Package, Users, Activity, Bell,
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
        class: `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-premium font-medium group ${
          active 
            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/20' 
            : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
        }`,
      };
    };
  }
</script>

<div class="flex h-screen bg-[var(--background)] overflow-hidden font-sans">
  <!-- Sidebar -->
  <aside class="fixed inset-y-0 left-0 z-40 w-64 bg-[#0a0f1d] border-r border-slate-800/40 text-white transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static {sidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col justify-between shrink-0">
    <div class="flex flex-col flex-1 min-h-0">
      <!-- Sidebar Header / Logo -->
      <div class="flex items-center gap-3 px-6 py-5 border-b border-slate-800/40">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 p-0.5 flex items-center justify-center overflow-hidden shadow-lg shadow-indigo-500/20">
          <img src={Logo} alt="Logo" class="w-full h-full object-cover rounded-lg bg-white" />
        </div>
        <div>
          <div class="text-[15px] font-bold tracking-tight text-white leading-none">DimInspect</div>
          <div class="text-[11px] text-indigo-400 font-medium mt-1">Quality Monitoring</div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 overflow-y-auto mt-6 px-4 space-y-1.5 scrollbar-thin">
        {#each visibleItems as item (item.to)}
          {@const Icon = item.icon}
          <Link to={item.to} getProps={linkPropsMap[item.to]}>
            <Icon class="w-[18px] h-[18px] transition-transform group-hover:scale-105" />
            <span>{item.label}</span>
          </Link>
        {/each}
      </nav>
    </div>

    <!-- Sidebar Footer / Profile -->
    <div class="p-4 border-t border-slate-800/40 bg-[#070b14]/60 relative">
      {#if userMenuOpen}
        <div class="absolute bottom-[80px] left-4 right-4 rounded-2xl bg-[#0f172a]/95 border border-slate-800/60 p-1.5 shadow-2xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button onclick={handleLogout} class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-left font-medium">
            <LogOut class="w-4 h-4" /> Keluar
          </button>
        </div>
      {/if}
      
      <button onclick={() => userMenuOpen = !userMenuOpen} class="flex w-full items-center gap-3 rounded-2xl p-2.5 hover:bg-slate-800/40 text-left transition-colors duration-200 group border border-transparent hover:border-slate-800/20">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center text-sm font-semibold text-indigo-300 group-hover:scale-105 transition-transform">
          {auth.user?.name?.charAt(0).toUpperCase() ?? ''}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-slate-200 truncate leading-none">{auth.user?.name ?? ''}</div>
          <div class="text-[11px] text-slate-400 font-medium mt-1 truncate">{roleLabels[auth.user?.role ?? ''] ?? ''}</div>
        </div>
        <ChevronUp class="w-4 h-4 text-slate-400 transition-transform duration-300 {userMenuOpen ? '' : 'rotate-180'}" />
      </button>
    </div>
  </aside>

  <!-- Mobile Overlay -->
  {#if sidebarOpen}
    <button class="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden" onclick={() => sidebarOpen = false} aria-label="Tutup sidebar"></button>
  {/if}

  <!-- Main Content Wrapper -->
  <div class="flex-1 flex flex-col min-w-0">
    <!-- Top Header -->
    <header class="h-16 border-b border-[var(--border)] flex items-center justify-between px-6 bg-[var(--card)] shadow-sm shadow-slate-100/5 z-20 shrink-0">
      <div class="flex items-center gap-3">
        <button class="lg:hidden p-2 text-[var(--foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-xl transition-colors duration-200" onclick={() => sidebarOpen = true} aria-label="Buka sidebar">
          <Menu class="w-5 h-5" />
        </button>
        <!-- System Status Bar -->
        <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          System Online
        </div>
      </div>

      <!-- Header Action Items -->
      <div class="flex items-center gap-2">
        <!-- Theme Toggle Button -->
        <button 
          onclick={() => theme.toggle()} 
          class="p-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] rounded-xl transition-all duration-200"
          title={theme.mode === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
        >
          {#if theme.mode === 'dark'}
            <Sun class="w-[18px] h-[18px] text-amber-400 animate-in spin-in-12 duration-300" />
          {:else}
            <Moon class="w-[18px] h-[18px] text-indigo-600" />
          {/if}
        </button>
      </div>
    </header>

    <!-- Page Content Container -->
    <main class="flex-1 overflow-y-auto p-5 lg:p-8 scrollbar-thin bg-slate-50/50 dark:bg-slate-950/40">
      <div class="max-w-[1600px] mx-auto animate-in fade-in duration-300">
        {@render children()}
      </div>
    </main>
  </div>
</div>
