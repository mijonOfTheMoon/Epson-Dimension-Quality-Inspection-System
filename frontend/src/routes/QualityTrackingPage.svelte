<script lang="ts">
  import { Search, ChevronDown, Send, Clock, Truck, CheckCircle2, Circle, AlertTriangle } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { useQualityRecords } from '$lib/hooks/useQualityRecords.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { QualityTrackingRecord, RequestStatus } from '$lib/types/api';

  type IconComponent = typeof Circle;

  type StatusCfg = { label: string; color: string; bg: string; icon: IconComponent };

  const STATUS_CONFIG: Record<RequestStatus, StatusCfg> = {
    not_requested: { label: 'Not Requested', color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800/60 border-slate-200/20', icon: Circle },
    requested: { label: 'Requested', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', icon: Send },
    in_progress: { label: 'In Progress', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: Clock },
    shipped: { label: 'Shipped', color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', icon: Truck },
    received: { label: 'Received', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  };

  const quality = useQualityRecords();

  let search = $state('');
  let filterDate = $state('');
  let filterVendor = $state('');
  let expandedRow = $state<string | null>(null);
  let toast = $state<string | null>(null);

  const role = $derived(auth.user?.role);
  const canRequest = $derived(role === 'engineering' || role === 'admin');
  const canUpdateVendor = $derived(role === 'vendor' || role === 'admin');

  const showToast = (msg: string) => {
    toast = msg;
    setTimeout(() => { toast = null; }, 3000);
  };

  const APP_TIMEZONE = import.meta.env.VITE_APP_TIMEZONE ?? 'Asia/Jakarta';
  const LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const summary = $derived.by(() => {
    const vendorSet = new Set<string>();
    const dateSet = new Set<string>();
    let totalScannedToday = 0;
    let totalNGToday = 0;
    let pendingRequests = 0;
    const today = LOCAL_DATE_FORMATTER.format(new Date());
    const lowerSearch = search.toLowerCase();
    const filtered: QualityTrackingRecord[] = [];

    for (const record of quality.data) {
      vendorSet.add(record.vendor);
      dateSet.add(record.date);
      if (record.date === today) {
        totalScannedToday += record.totalScanned;
        totalNGToday += record.ngCount;
      }
      if (record.requestStatus === 'requested' || record.requestStatus === 'in_progress') pendingRequests += 1;
      const matchSearch = !lowerSearch
        || record.partName.toLowerCase().includes(lowerSearch)
        || record.partCode.toLowerCase().includes(lowerSearch)
        || record.vendor.toLowerCase().includes(lowerSearch);
      const matchDate = !filterDate || record.date === filterDate;
      const matchVendor = !filterVendor || record.vendor === filterVendor;
      if (matchSearch && matchDate && matchVendor) filtered.push(record);
    }
    const avgNGRate = totalScannedToday > 0 ? ((totalNGToday / totalScannedToday) * 100).toFixed(1) : '0.0';
    return {
      vendors: [...vendorSet],
      dates: [...dateSet].sort().reverse(),
      filtered,
      totalScannedToday,
      totalNGToday,
      avgNGRate,
      pendingRequests,
    };
  });

  const handleStatusChange = async (recordId: string, newStatus: RequestStatus) => {
    try {
      const updated = await api.updateQualityStatus(recordId, newStatus);
      quality.update(updated);
      showToast(`Status berhasil diubah ke "${STATUS_CONFIG[newStatus].label}"`);
    } catch (err) {
      showToast(getErrorMessage(err));
    }
  };

  const actionsFor = (record: QualityTrackingRecord) => {
    const actions: { label: string; status: RequestStatus; icon: IconComponent }[] = [];
    const s = record.requestStatus;
    if (canRequest) {
      if (s === 'not_requested') actions.push({ label: 'Kirim Request ke Vendor', status: 'requested', icon: Send });
      if (s === 'shipped') actions.push({ label: 'Konfirmasi Diterima', status: 'received', icon: CheckCircle2 });
    }
    if (canUpdateVendor) {
      if (s === 'requested') actions.push({ label: 'Proses Permintaan', status: 'in_progress', icon: Clock });
      if (s === 'in_progress') actions.push({ label: 'Tandai Dikirim', status: 'shipped', icon: Truck });
    }
    return actions;
  };
</script>

<div class="space-y-6 select-none font-sans">
  {#if toast}
    <div class="fixed top-6 right-6 z-50 bg-emerald-600/95 border border-emerald-500/30 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold animate-in fade-in slide-in-from-top-4 duration-300">{toast}</div>
  {/if}

  <!-- Page Title Header -->
  <div>
    <h1 class="text-slate-900 dark:text-white tracking-tight">Quality Tracking</h1>
    <p class="text-[var(--muted-foreground)] text-sm mt-1.5 font-medium">
      Monitoring rasio kegagalan (NG) harian per jenis part &amp; kontrol alur permintaan ke vendor.
    </p>
  </div>

  {#if quality.error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl p-4.5 text-sm flex items-center justify-between gap-4">
      <span>{quality.error}</span>
      <button onclick={quality.reload} class="px-3.5 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold">Coba lagi</button>
    </div>
  {/if}

  {#if quality.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat data tracking kualitas...</span>
    </div>
  {/if}

  <!-- Quality Performance KPIs -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4.5">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Total Scan Hari Ini</div>
      <div class="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-2 font-mono-data" style="letter-spacing: -0.02em;">{summary.totalScannedToday}</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Total NG Hari Ini</div>
      <div class="text-3xl font-extrabold text-rose-500 mt-2 font-mono-data" style="letter-spacing: -0.02em;">{summary.totalNGToday}</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Rata-rata NG Rate</div>
      <div class="text-3xl font-extrabold mt-2 font-mono-data {parseFloat(summary.avgNGRate) > 5 ? 'text-rose-500' : 'text-emerald-500'}" style="letter-spacing: -0.02em;">{summary.avgNGRate}%</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Request Pending</div>
      <div class="text-3xl font-extrabold text-amber-500 mt-2 font-mono-data" style="letter-spacing: -0.02em;">{summary.pendingRequests}</div>
    </div>
  </div>

  <!-- Filters and Search Panel -->
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1 min-w-[240px]">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="text"
        placeholder="Cari part, kode, atau vendor..."
        bind:value={search}
        class="input pl-10 pr-4 py-2.5"
      />
    </div>
    <select bind:value={filterDate} class="input min-w-[170px] w-auto py-2.5 px-3">
      <option value="">Semua Tanggal</option>
      {#each summary.dates as date (date)}
        <option value={date}>{new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</option>
      {/each}
    </select>
    <select bind:value={filterVendor} class="input min-w-[160px] w-auto py-2.5 px-3">
      <option value="">Semua Vendor</option>
      {#each summary.vendors as vendor (vendor)}
        <option value={vendor}>{vendor}</option>
      {/each}
    </select>
  </div>

  <!-- Quality Main Table -->
  <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
            <th class="px-5 py-4">Tanggal</th>
            <th class="px-5 py-4">Part / Spesifikasi</th>
            <th class="px-5 py-4">Vendor</th>
            <th class="px-5 py-4 text-center">Total Scan</th>
            <th class="px-5 py-4 text-center">NG</th>
            <th class="px-5 py-4 text-center">NG Rate</th>
            <th class="px-5 py-4 text-center">Status Request</th>
            <th class="px-5 py-4 w-10"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-200">
          {#each summary.filtered as record (record.id)}
            {@const statusCfg = STATUS_CONFIG[record.requestStatus]}
            {@const StatusIcon = statusCfg.icon}
            {@const isExpanded = expandedRow === record.id}
            {@const actions = actionsFor(record)}
            <tr
              class="cursor-pointer transition-premium duration-150 {isExpanded ? 'bg-indigo-500/5 dark:bg-indigo-950/20' : 'hover:bg-slate-50/50 dark:hover:bg-slate-900/10'}"
              onclick={() => expandedRow = isExpanded ? null : record.id}
            >
              <td class="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-400">
                {new Date(record.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
              <td class="px-5 py-3.5">
                <div class="font-bold text-slate-900 dark:text-white">{record.partName}</div>
                <div class="text-[10px] text-[var(--muted-foreground)] font-semibold mt-1 font-mono-data">Code: {record.partCode}</div>
              </td>
              <td class="px-5 py-3.5 text-xs text-slate-600 dark:text-slate-300 font-semibold">{record.vendor}</td>
              <td class="px-5 py-3.5 text-center font-semibold font-mono-data text-xs">{record.totalScanned}</td>
              <td class="px-5 py-3.5 text-center">
                <span class="font-bold font-mono-data text-xs {record.ngCount > 0 ? 'text-rose-500' : 'text-slate-500'}">{record.ngCount}</span>
              </td>
              <td class="px-5 py-3.5 text-center">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase border {
                  record.ngRate > 5 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400' 
                    : record.ngRate > 2 
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400' 
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                }">
                  {#if record.ngRate > 5}<AlertTriangle class="w-3.5 h-3.5" />{/if}
                  {record.ngRate}%
                </span>
              </td>
              <td class="px-5 py-3.5 text-center">
                <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border shadow-inner {statusCfg.bg} {statusCfg.color}">
                  <StatusIcon class="w-3.5 h-3.5" />
                  {statusCfg.label}
                </span>
              </td>
              <td class="px-5 py-3.5 text-center">
                <ChevronDown class="w-4 h-4 text-slate-400 transition-transform duration-300 {isExpanded ? 'rotate-180' : ''}" />
              </td>
            </tr>

            {#if isExpanded}
              <tr>
                <td colspan="8" class="px-5 py-5 bg-slate-50/50 dark:bg-slate-900/20 border-t border-b border-[var(--border)]">
                  <div class="flex flex-col lg:flex-row gap-8">
                    <!-- Progress Timeline Stepper -->
                    <div class="flex-1">
                      <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase mb-4 pl-1">
                        Riwayat Perubahan Status Permintaan
                      </div>
                      <div class="flex flex-wrap sm:flex-nowrap items-start gap-4 sm:gap-0 mt-2">
                        {#each record.statusHistory as historyEntry, idx (idx)}
                          {@const hCfg = STATUS_CONFIG[historyEntry.status]}
                          {@const HIcon = hCfg.icon}
                          {@const isCurrent = idx === record.statusHistory.length - 1}
                          <div class="flex flex-row sm:flex-col items-center relative flex-1 min-w-[140px] sm:min-w-0">
                            <!-- Connecting horizontal timeline bar for non-first items on large screens -->
                            {#if idx > 0}
                              <div class="hidden sm:block absolute top-[13px] right-[50%] h-[2px] bg-slate-200 dark:bg-slate-800 w-full -z-0"></div>
                            {/if}
                            <!-- timeline circle bubble -->
                            <div class="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 z-10 {isCurrent ? hCfg.bg : 'bg-slate-100 dark:bg-slate-800/80'} border border-transparent {isCurrent ? 'border-current ' + hCfg.color : ''} shadow-md shadow-slate-200/5 hover:scale-105 transition-transform duration-200">
                              <HIcon class="w-4 h-4 {isCurrent ? hCfg.color : 'text-slate-400 dark:text-slate-500'}" />
                            </div>
                            <!-- step label metadata -->
                            <div class="ml-3 sm:ml-0 mt-0 sm:mt-3 text-left sm:text-center">
                              <div class="text-[11px] font-bold {isCurrent ? hCfg.color : 'text-slate-500 dark:text-slate-400'}">
                                {hCfg.label}
                              </div>
                              <div class="text-[9px] text-[var(--muted-foreground)] mt-1 font-semibold font-mono-data">
                                {new Date(historyEntry.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div class="text-[9px] text-[var(--muted-foreground)] font-bold uppercase tracking-wider mt-0.5">{historyEntry.changedBy}</div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    </div>

                    <!-- Interactive Vendor Status Actions Button -->
                    {#if actions.length > 0}
                      <div class="lg:border-l lg:border-[var(--border)] lg:pl-8 flex flex-col gap-2.5 items-center justify-center shrink-0 w-full lg:w-fit">
                        {#each actions as action (action.status)}
                          {@const AIcon = action.icon}
                          <button
                            onclick={(event) => { event.stopPropagation(); void handleStatusChange(record.id, action.status); }}
                            class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium whitespace-nowrap w-full lg:w-fit"
                          >
                            <AIcon class="w-4 h-4" />
                            {action.label}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}

          {#if summary.filtered.length === 0}
            <tr>
              <td colspan="8" class="px-5 py-16 text-center text-[var(--muted-foreground)] font-medium">
                Tidak ditemukan data kualitas untuk kriteria pencarian dan filter terpilih.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
