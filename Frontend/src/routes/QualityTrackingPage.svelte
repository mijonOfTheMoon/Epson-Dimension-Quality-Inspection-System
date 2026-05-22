<script lang="ts">
  import { Search, ChevronDown, Send, Clock, Truck, CheckCircle2, Circle, AlertTriangle } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { useQualityRecords } from '$lib/hooks/useQualityRecords.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { QualityTrackingRecord, RequestStatus } from '$lib/types/api';

  type IconComponent = typeof Circle;

  type StatusCfg = { label: string; color: string; bg: string; icon: IconComponent };

  const STATUS_CONFIG: Record<RequestStatus, StatusCfg> = {
    not_requested: { label: 'Not Requested', color: 'text-gray-600', bg: 'bg-gray-100', icon: Circle },
    requested: { label: 'Requested', color: 'text-blue-700', bg: 'bg-blue-100', icon: Send },
    in_progress: { label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
    shipped: { label: 'Shipped', color: 'text-purple-700', bg: 'bg-purple-100', icon: Truck },
    received: { label: 'Received', color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2 },
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

  const summary = $derived.by(() => {
    const vendorSet = new Set<string>();
    const dateSet = new Set<string>();
    let totalScannedToday = 0;
    let totalNGToday = 0;
    let pendingRequests = 0;
    const today = new Date().toISOString().slice(0, 10);
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

<div class="space-y-5">
  {#if toast}
    <div class="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm">{toast}</div>
  {/if}

  <div>
    <h1>Quality Tracking</h1>
    <p class="text-[var(--muted-foreground)] text-sm mt-1">
      Monitoring NG ratio harian per part &amp; manajemen permintaan part ke vendor
    </p>
  </div>

  {#if quality.error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
      <span>{quality.error}</span>
      <button onclick={quality.reload} class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
    </div>
  {/if}

  {#if quality.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat quality records dari backend...
    </div>
  {/if}

  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="text-xs text-[var(--muted-foreground)]">Total Scan Hari Ini</div>
      <div class="text-2xl text-blue-700 mt-1" style="font-weight: 500">{summary.totalScannedToday}</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="text-xs text-[var(--muted-foreground)]">Total NG Hari Ini</div>
      <div class="text-2xl text-red-600 mt-1" style="font-weight: 500">{summary.totalNGToday}</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="text-xs text-[var(--muted-foreground)]">Rata-rata NG Rate</div>
      <div class="text-2xl mt-1 {parseFloat(summary.avgNGRate) > 5 ? 'text-red-600' : 'text-green-600'}" style="font-weight: 500">{summary.avgNGRate}%</div>
    </div>
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="text-xs text-[var(--muted-foreground)]">Request Pending</div>
      <div class="text-2xl text-amber-600 mt-1" style="font-weight: 500">{summary.pendingRequests}</div>
    </div>
  </div>

  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
      <input
        type="text"
        placeholder="Cari part, kode, atau vendor..."
        bind:value={search}
        class="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
      />
    </div>
    <select bind:value={filterDate} class="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]">
      <option value="">Semua Tanggal</option>
      {#each summary.dates as date (date)}
        <option value={date}>{new Date(date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</option>
      {/each}
    </select>
    <select bind:value={filterVendor} class="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]">
      <option value="">Semua Vendor</option>
      {#each summary.vendors as vendor (vendor)}
        <option value={vendor}>{vendor}</option>
      {/each}
    </select>
  </div>

  <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--accent)] text-left">
            <th class="px-4 py-3">Tanggal</th>
            <th class="px-4 py-3">Part</th>
            <th class="px-4 py-3">Vendor</th>
            <th class="px-4 py-3 text-center">Total Scan</th>
            <th class="px-4 py-3 text-center">NG</th>
            <th class="px-4 py-3 text-center">NG Rate</th>
            <th class="px-4 py-3 text-center">Status</th>
            <th class="px-4 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {#each summary.filtered as record (record.id)}
            {@const statusCfg = STATUS_CONFIG[record.requestStatus]}
            {@const StatusIcon = statusCfg.icon}
            {@const isExpanded = expandedRow === record.id}
            {@const actions = actionsFor(record)}
            <tr
              class="border-t border-[var(--border)] cursor-pointer transition-colors {isExpanded ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'hover:bg-[var(--accent)]/50'}"
              onclick={() => expandedRow = isExpanded ? null : record.id}
            >
              <td class="px-4 py-3 whitespace-nowrap">
                {new Date(record.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
              <td class="px-4 py-3">
                <div style="font-weight: 500">{record.partName}</div>
                <div class="text-xs text-[var(--muted-foreground)]">{record.partCode}</div>
              </td>
              <td class="px-4 py-3 text-xs">{record.vendor}</td>
              <td class="px-4 py-3 text-center">{record.totalScanned}</td>
              <td class="px-4 py-3 text-center">
                <span class={record.ngCount > 0 ? 'text-red-600' : ''}>{record.ngCount}</span>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs {record.ngRate > 5 ? 'bg-red-100 text-red-700' : record.ngRate > 2 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}">
                  {#if record.ngRate > 5}<AlertTriangle class="w-3 h-3" />{/if}
                  {record.ngRate}%
                </span>
              </td>
              <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs {statusCfg.bg} {statusCfg.color}">
                  <StatusIcon class="w-3 h-3" />
                  {statusCfg.label}
                </span>
              </td>
              <td class="px-4 py-3 text-center">
                <ChevronDown class="w-4 h-4 text-[var(--muted-foreground)] transition-transform {isExpanded ? 'rotate-180' : ''}" />
              </td>
            </tr>

            {#if isExpanded}
              <tr class="bg-blue-50/40 dark:bg-blue-950/20">
                <td colspan="8" class="px-4 py-4">
                  <div class="flex flex-col lg:flex-row gap-6">
                    <div class="flex-1">
                      <div class="text-xs text-[var(--muted-foreground)] mb-3" style="font-weight: 500">
                        Riwayat Perubahan Status
                      </div>
                      <div class="flex items-start gap-0">
                        {#each record.statusHistory as historyEntry, idx (idx)}
                          {@const hCfg = STATUS_CONFIG[historyEntry.status]}
                          {@const HIcon = hCfg.icon}
                          {@const isCurrent = idx === record.statusHistory.length - 1}
                          <div class="flex flex-col items-center relative" style="min-width: 100px; flex: 1">
                            {#if idx > 0}
                              <div class="absolute top-3 right-1/2 h-0.5 bg-gray-200 w-full -z-0"></div>
                            {/if}
                            <div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 {isCurrent ? hCfg.bg : 'bg-gray-100'} border-2 {isCurrent ? 'border-current ' + hCfg.color : 'border-gray-200'}">
                              <HIcon class="w-3 h-3 {isCurrent ? hCfg.color : 'text-gray-400'}" />
                            </div>
                            <div class="mt-1.5 text-center">
                              <div class="text-[11px] {isCurrent ? hCfg.color : 'text-gray-500'}" style="font-weight: {isCurrent ? 500 : 400}">
                                {hCfg.label}
                              </div>
                              <div class="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                                {new Date(historyEntry.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div class="text-[10px] text-[var(--muted-foreground)]">{historyEntry.changedBy}</div>
                            </div>
                          </div>
                        {/each}
                      </div>
                    </div>

                    {#if actions.length > 0}
                      <div class="lg:border-l lg:border-[var(--border)] lg:pl-6 flex flex-col gap-2 items-center justify-center shrink-0">
                        {#each actions as action (action.status)}
                          {@const AIcon = action.icon}
                          <button
                            onclick={(event) => { event.stopPropagation(); void handleStatusChange(record.id, action.status); }}
                            class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors whitespace-nowrap w-fit"
                          >
                            <AIcon class="w-3.5 h-3.5" />
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
              <td colspan="8" class="px-4 py-12 text-center text-[var(--muted-foreground)]">
                Tidak ada data yang cocok dengan filter.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
