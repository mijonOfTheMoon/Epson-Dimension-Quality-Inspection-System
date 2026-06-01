<script lang="ts">
  import { Search, Download, ChevronDown, ChevronUp } from 'lucide-svelte';
  import { useInspections } from '$lib/hooks/useInspections.svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import FrameThumbnail from '$lib/components/FrameThumbnail.svelte';
  import { api, getErrorMessage } from '$lib/services/api';

  const inspections = useInspections(1000);
  const parts = useParts();

  let search = $state('');
  let statusFilter = $state<'all' | 'OK' | 'NG'>('all');
  let partFilter = $state('all');
  let expandedId = $state<string | null>(null);

  let detailLoading = $state<Record<string, boolean>>({});
  let detailErrors = $state<Record<string, string>>({});
  let details = $state<Record<string, any>>({});

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      expandedId = null;
      return;
    }

    expandedId = id;
    if (!details[id] && !detailLoading[id]) {
      detailLoading[id] = true;
      detailErrors[id] = '';
      try {
        const data = await api.getInspectionDetail(id);
        details[id] = data;
      } catch (err) {
        detailErrors[id] = getErrorMessage(err);
      } finally {
        detailLoading[id] = false;
      }
    }
  };
  let page = $state(1);
  const perPage = 15;

  const loading = $derived(inspections.loading || parts.loading);
  const error = $derived(inspections.error || parts.error);

  const filtered = $derived.by(() => {
    const q = search.toLowerCase();
    return inspections.data.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (partFilter !== 'all' && row.partCode !== partFilter) return false;
      if (q) {
        return row.id.toLowerCase().includes(q)
          || row.partName.toLowerCase().includes(q)
          || row.operatorName.toLowerCase().includes(q);
      }
      return true;
    });
  });

  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / perPage)));
  const currentPage = $derived(Math.min(page, totalPages));
  const paginated = $derived(filtered.slice((currentPage - 1) * perPage, currentPage * perPage));

  const csvField = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const exportCSV = () => {
    const headers = ['ID', 'Part', 'Part Code', 'Status', 'Operator', 'Station', 'Timestamp', 'Confidence', 'FrameUrl'];
    const lines = [headers.map(csvField).join(',')];
    for (const r of filtered) {
      lines.push([
        r.id, r.partName, r.partCode, r.status, r.operatorName, r.stationId,
        r.timestamp, r.confidenceScore, r.frameUrl ?? '',
      ].map(csvField).join(','));
    }
    const blob = new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inspection_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const retry = () => {
    inspections.reload();
    parts.reload();
  };

  const onSearchInput = (event: Event) => {
    search = (event.currentTarget as HTMLInputElement).value;
    page = 1;
  };
  const onStatusChange = (event: Event) => {
    statusFilter = (event.currentTarget as HTMLSelectElement).value as 'all' | 'OK' | 'NG';
    page = 1;
  };
  const onPartChange = (event: Event) => {
    partFilter = (event.currentTarget as HTMLSelectElement).value;
    page = 1;
  };
  const goToPreviousPage = () => {
    page = Math.max(1, currentPage - 1);
  };
  const goToNextPage = () => {
    page = Math.min(totalPages, currentPage + 1);
  };
</script>

<div class="space-y-6 select-none font-sans">
  <!-- Title Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Riwayat Inspeksi</h1>
      <p class="text-[var(--muted-foreground)] text-sm mt-1.5 font-medium">Traceability data dan hasil ukur historis untuk analisis kualitas berlanjut.</p>
    </div>
    <button 
      onclick={exportCSV} 
      class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium self-start sm:self-auto"
    >
      <Download class="w-4 h-4" /> Export CSV
    </button>
  </div>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl p-4.5 text-sm flex items-center justify-between gap-4">
      <span>{error}</span>
      <button onclick={retry} class="px-3.5 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold">Coba lagi</button>
    </div>
  {/if}

  {#if loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat arsip riwayat data...</span>
    </div>
  {/if}

  <!-- Search & Filter Controls -->
  <div class="flex flex-wrap items-center gap-3">
    <div class="relative flex-1 min-w-[240px]">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        value={search}
        oninput={onSearchInput}
        class="input pl-10 pr-4 py-2.5"
        placeholder="Cari ID, nama part, operator..."
      />
    </div>
    <select value={statusFilter} onchange={onStatusChange} class="input min-w-[130px] w-auto py-2.5 px-3">
      <option value="all">Semua Status</option>
      <option value="OK">OK</option>
      <option value="NG">NG</option>
    </select>
    <select value={partFilter} onchange={onPartChange} class="input min-w-[160px] w-auto py-2.5 px-3">
      <option value="all">Semua Jenis Part</option>
      {#each parts.data as part (part.id)}
        <option value={part.partCode}>{part.partName}</option>
      {/each}
    </select>
  </div>

  <!-- Count Stats -->
  <div class="text-xs text-[var(--muted-foreground)] font-bold tracking-wide bg-slate-100/50 dark:bg-slate-900/30 border border-[var(--border)] w-fit px-3 py-1.5 rounded-lg shadow-sm">
    Ditemukan: <span class="text-indigo-500 font-mono-data">{filtered.length}</span> baris data
  </div>

  <!-- Master Data Table -->
  <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
            <th class="px-5 py-4">Part / Kode</th>
            <th class="px-5 py-4">Status</th>
            <th class="px-5 py-4">Confidence</th>
            <th class="px-5 py-4">Waktu Pengerjaan</th>
            <th class="px-5 py-4 text-right">Detail</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-200">
          {#each paginated as row (row.id)}
            {@const isOK = row.status === 'OK'}
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-premium duration-150">
              <td class="px-5 py-3.5">
                <div class="font-semibold text-slate-900 dark:text-white">{row.partName}</div>
                <div class="text-[10px] text-[var(--muted-foreground)] font-semibold font-mono-data mt-1.5">Code: {row.partCode} &bull; Vendor: {row.vendor}</div>
              </td>
              <td class="px-5 py-3.5">
                <span class="inline-flex px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wide uppercase {
                  isOK 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
                }">
                  {row.status}
                </span>
              </td>
              <td class="px-5 py-3.5 font-mono-data font-bold text-xs text-slate-700 dark:text-slate-300">{row.confidenceScore}%</td>
              <td class="px-5 py-3.5 text-xs text-slate-500 dark:text-slate-400 font-semibold">{new Date(row.timestamp).toLocaleString('id-ID')}</td>
              <td class="px-5 py-3.5 text-right">
                <button 
                  onclick={() => toggleExpand(row.id)} 
                  class="p-2 border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-xl transition-premium shadow-sm text-slate-500 dark:text-slate-400" 
                  aria-label="Tampilkan detail"
                >
                  {#if expandedId === row.id}
                    <ChevronUp class="w-4 h-4" />
                  {:else}
                    <ChevronDown class="w-4 h-4" />
                  {/if}
                </button>
              </td>
            </tr>
            {#if expandedId === row.id}
              <tr>
                <td colspan="5" class="px-5 py-5 bg-slate-50/50 dark:bg-slate-900/20 border-t border-b border-[var(--border)]">
                  {#if detailLoading[row.id]}
                    <div class="text-xs text-[var(--muted-foreground)] font-bold py-6 text-center animate-pulse flex items-center justify-center gap-2">
                      <span class="w-3.5 h-3.5 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
                      <span>Menganalisis dan memuat rincian pengukuran...</span>
                    </div>
                  {:else if detailErrors[row.id]}
                    <div class="text-xs text-rose-500 font-bold py-6 text-center border border-rose-500/10 rounded-xl bg-rose-500/5">
                      Gagal memperoleh data: {detailErrors[row.id]}
                    </div>
                  {:else if details[row.id]}
                    {@const detail = details[row.id]}
                    <div class="space-y-4">
                      <!-- Operator Metadata -->
                      <div class="text-xs text-slate-700 dark:text-slate-300 font-bold border-l-2 border-indigo-500 pl-2">
                        Hasil Analisis Dimensi &bull; Operator: <span class="text-slate-950 dark:text-white">{detail.operatorName}</span>
                      </div>

                      <!-- Measurement Cards Grid -->
                      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {#each detail.measurements as measurement (measurement.dimensionName)}
                          {@const mOK = measurement.status === 'OK'}
                          <div class="p-3.5 rounded-xl border shadow-inner transition-premium hover:-translate-y-[1px] {
                            mOK 
                              ? 'bg-emerald-500/5 border-emerald-500/10 dark:border-emerald-500/5' 
                              : 'bg-rose-500/5 border-rose-500/10 dark:border-rose-500/5'
                          }">
                            <div class="text-[10px] text-[var(--muted-foreground)] font-bold tracking-wide">{measurement.dimensionName}</div>
                            <div class="text-base font-extrabold mt-2 flex items-baseline gap-1.5 font-mono-data">
                              <span class={mOK ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                {measurement.measured} {measurement.unit}
                              </span>
                              <span class="text-[10px] font-sans font-bold px-1.5 py-0.5 rounded uppercase {
                                mOK ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                              }">
                                {measurement.status}
                              </span>
                            </div>
                            <div class="text-[10px] text-[var(--muted-foreground)] font-medium mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/40">
                              Nominal: <span class="text-slate-700 dark:text-slate-300">{measurement.nominal}</span> &bull; Range: <span class="text-slate-700 dark:text-slate-300">{measurement.lowerLimit} ~ {measurement.upperLimit} {measurement.unit}</span>
                            </div>
                          </div>
                        {/each}
                      </div>

                      <!-- Camera Frame and Detections Overlay -->
                      {#if detail.frameUrl}
                        <div class="mt-4 max-w-xl relative rounded-2xl overflow-hidden shadow-lg border border-[var(--border)] bg-black">
                          <FrameThumbnail eventId={detail.id} initialUrl={detail.frameUrl} className="w-full h-auto block" />
                          {#each detail.detections as detection (detection.id)}
                            <div
                              class="absolute pointer-events-none border-2 {detection.status === 'OK' ? 'border-emerald-400 bbox-ok' : 'border-rose-400 bbox-ng'}"
                              style="left: {detection.bbox.x}%; top: {detection.bbox.y}%; width: {detection.bbox.width}%; height: {detection.bbox.height}%;"
                            >
                              <span class="absolute -top-6 left-0 px-2 py-0.5 bg-slate-900/90 text-white text-[9px] font-bold rounded-lg border border-slate-700/20 whitespace-nowrap shadow-md">
                                {detection.label}
                              </span>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
          {#if !loading && paginated.length === 0}
            <tr>
              <td colspan="5" class="px-5 py-16 text-center text-[var(--muted-foreground)] font-medium">
                {inspections.data.length === 0 ? 'Belum ada rekaman arsip data inspeksi.' : 'Tidak ditemukan baris data yang cocok dengan kriteria filter.'}
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Pagination Controls -->
  {#if totalPages > 1}
    <div class="flex items-center justify-center gap-3.5 pt-4">
      <button 
        disabled={currentPage <= 1} 
        onclick={goToPreviousPage} 
        class="px-4 py-2 border border-[var(--border)] rounded-xl text-xs font-bold bg-[var(--card)] hover:bg-[var(--accent)] text-slate-700 dark:text-slate-300 disabled:opacity-50 transition-premium shadow-sm hover:shadow"
      >
        Prev
      </button>
      <span class="text-xs text-[var(--muted-foreground)] font-bold font-mono-data">
        Halaman {currentPage} / {totalPages}
      </span>
      <button 
        disabled={currentPage >= totalPages} 
        onclick={goToNextPage} 
        class="px-4 py-2 border border-[var(--border)] rounded-xl text-xs font-bold bg-[var(--card)] hover:bg-[var(--accent)] text-slate-700 dark:text-slate-300 disabled:opacity-50 transition-premium shadow-sm hover:shadow"
      >
        Next
      </button>
    </div>
  {/if}
</div>
