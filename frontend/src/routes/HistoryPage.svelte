<script lang="ts">
  import { Search, Download, ChevronDown, ChevronUp, Share2, Calendar } from 'lucide-svelte';
  import { useInspections } from '$lib/hooks/useInspections.svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import FrameThumbnail from '$lib/components/FrameThumbnail.svelte';
  import ShareRecapModal from '$lib/components/ShareRecapModal.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import {
    detailLoadReducer,
    DETAIL_TIMEOUT_MS,
    type DetailLoadState,
    type DetailLoadEvent,
  } from '$lib/utils/detailLoadState';
  import { resolveEntryOverlay } from '$lib/utils/historyOverlay';
  import { measurementStatusLabel } from '$lib/utils/selection';
  import type { ShareRecapFilters } from '$lib/types/api';

  const inspections = useInspections(200);
  const parts = useParts();

  let search = $state('');
  let statusFilter = $state<'all' | 'OK' | 'NG'>('all');
  let partFilter = $state('all');
  let rangePreset = $state<'all' | 'today' | '7d' | '30d' | 'custom'>('all');
  let customFrom = $state('');
  let customTo = $state('');
  let rangeOpen = $state(false);
  let expandedId = $state<string | null>(null);

  let detailState = $state<Record<string, DetailLoadState>>({});
  let details = $state<Record<string, any>>({});
  let detailAspect = $state<Record<string, number>>({});
  let shareOpen = $state(false);

  const dispatchDetail = (id: string, event: DetailLoadEvent) => {
    detailState[id] = detailLoadReducer(detailState[id] ?? { phase: 'idle' }, event);
  };

  const TIMED_OUT = Symbol('detail-timeout');

  const withDetailTimeout = <T,>(promise: Promise<T>): Promise<T | typeof TIMED_OUT> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(TIMED_OUT), DETAIL_TIMEOUT_MS);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      expandedId = null;
      dispatchDetail(id, { type: 'collapse' });
      return;
    }

    expandedId = id;

    if (details[id]) {
      dispatchDetail(id, { type: 'resolve' });
      return;
    }

    dispatchDetail(id, { type: 'expand' });
    try {
      const result = await withDetailTimeout(api.getInspectionDetail(id));
      if (detailState[id]?.phase !== 'loading') return;
      if (result === TIMED_OUT) {
        dispatchDetail(id, { type: 'timeout' });
        return;
      }
      details[id] = result;
      dispatchDetail(id, { type: 'resolve' });
    } catch (err) {
      if (detailState[id]?.phase !== 'loading') return;
      dispatchDetail(id, { type: 'reject', error: getErrorMessage(err) });
    }
  };
  let page = $state(1);
  const perPage = 15;

  const loading = $derived(inspections.loading || parts.loading);
  const error = $derived(inspections.error || parts.error);

  const rangeBounds = $derived.by(() => {
    const now = new Date();
    if (rangePreset === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { from: start, to: null as Date | null };
    }
    if (rangePreset === '7d') return { from: new Date(now.getTime() - 7 * 86400000), to: null as Date | null };
    if (rangePreset === '30d') return { from: new Date(now.getTime() - 30 * 86400000), to: null as Date | null };
    if (rangePreset === 'custom') {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      const to = customTo ? new Date(`${customTo}T23:59:59`) : null;
      return { from, to };
    }
    return { from: null as Date | null, to: null as Date | null };
  });

  const customInvalid = $derived(
    rangePreset === 'custom' && customFrom !== '' && customTo !== '' && customFrom > customTo,
  );

  const filtered = $derived.by(() => {
    const q = search.toLowerCase();
    const { from, to } = customInvalid ? { from: null, to: null } : rangeBounds;
    const fromMs = from ? from.getTime() : null;
    const toMs = to ? to.getTime() : null;
    return inspections.data.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (partFilter !== 'all' && row.partCode !== partFilter) return false;
      if (fromMs !== null || toMs !== null) {
        const ts = new Date(row.timestamp).getTime();
        if (fromMs !== null && ts < fromMs) return false;
        if (toMs !== null && ts > toMs) return false;
      }
      if (q) {
        return row.id.toLowerCase().includes(q)
          || row.partName.toLowerCase().includes(q)
          || row.operatorName.toLowerCase().includes(q);
      }
      return true;
    });
  });

  const rangeLabel = $derived(
    rangePreset === 'today' ? 'Hari ini'
      : rangePreset === '7d' ? '7 hari'
        : rangePreset === '30d' ? '30 hari'
          : rangePreset === 'custom' ? `${customFrom || '...'} s/d ${customTo || '...'}`
            : 'Semua waktu',
  );

  const scopeLabel = $derived(
    [
      rangeLabel,
      statusFilter !== 'all' ? `Status ${statusFilter}` : null,
      partFilter !== 'all' ? `Part ${partFilter}` : null,
      search.trim() ? `Pencarian "${search.trim()}"` : null,
    ].filter(Boolean).join(' · '),
  );

  const shareFilters = $derived<ShareRecapFilters>({
    search: search.trim() || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    partCode: partFilter === 'all' ? undefined : partFilter,
    from: !customInvalid && rangeBounds.from ? rangeBounds.from.toISOString() : undefined,
    to: !customInvalid && rangeBounds.to ? rangeBounds.to.toISOString() : undefined,
  });

  const sharePreview = $derived({
    total: filtered.length,
    ok: filtered.filter((row) => row.status === 'OK').length,
    ng: filtered.filter((row) => row.status === 'NG').length,
  });

  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / perPage)));
  const currentPage = $derived(Math.min(page, totalPages));
  const paginated = $derived(filtered.slice((currentPage - 1) * perPage, currentPage * perPage));

  const csvField = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const exportCSV = () => {
    const headers = ['ID', 'Part', 'Part Code', 'Status', 'Operator', 'Station', 'Timestamp', 'Akurasi', 'FrameUrl'];
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
  const RANGE_OPTIONS: { value: typeof rangePreset; label: string }[] = [
    { value: 'all', label: 'Semua Waktu' },
    { value: 'today', label: 'Hari ini' },
    { value: '7d', label: '7 hari' },
    { value: '30d', label: '30 hari' },
    { value: 'custom', label: 'Custom' },
  ];
  const selectRange = (value: typeof rangePreset) => {
    rangePreset = value;
    page = 1;
    if (value !== 'custom') rangeOpen = false;
  };
  const onCustomFrom = (event: Event) => {
    customFrom = (event.currentTarget as HTMLInputElement).value;
    page = 1;
  };
  const onCustomTo = (event: Event) => {
    customTo = (event.currentTarget as HTMLInputElement).value;
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
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Riwayat Inspeksi</h1>
    </div>
    <div class="flex items-center gap-2.5 self-start sm:self-auto">
      <button
        disabled={filtered.length === 0}
        onclick={() => (shareOpen = true)}
        class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-sky-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
      >
        <Share2 class="w-4 h-4" /> Bagikan Rekap
      </button>
      <button 
        onclick={exportCSV} 
        class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium"
      >
        <Download class="w-4 h-4" /> Export CSV
      </button>
    </div>
  </div>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl p-4.5 text-sm flex items-center justify-between gap-4">
      <span>{error}</span>
      <button onclick={retry} class="px-3.5 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold">Coba lagi</button>
    </div>
  {/if}

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
    <div class="relative">
      <button
        type="button"
        onclick={() => (rangeOpen = !rangeOpen)}
        class="input w-auto py-2.5 px-3 inline-flex items-center gap-2 font-semibold text-xs {rangePreset !== 'all' ? 'text-indigo-600 dark:text-indigo-400 border-indigo-500/40' : ''}"
      >
        <Calendar class="w-4 h-4 shrink-0" />
        <span class="whitespace-nowrap">{rangeLabel}</span>
        <ChevronDown class="w-3.5 h-3.5 shrink-0 transition-transform {rangeOpen ? 'rotate-180' : ''}" />
      </button>
      {#if rangeOpen}
        <button class="fixed inset-0 z-30" onclick={() => (rangeOpen = false)} aria-label="Tutup pilihan waktu"></button>
        <div class="absolute right-0 mt-2 z-40 w-64 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-150">
          <div class="space-y-0.5">
            {#each RANGE_OPTIONS as option (option.value)}
              <button
                type="button"
                onclick={() => selectRange(option.value)}
                class="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors {
                  rangePreset === option.value
                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-[var(--accent)]'
                }"
              >
                {option.label}
              </button>
            {/each}
          </div>
          {#if rangePreset === 'custom'}
            <div class="mt-2 pt-2 border-t border-[var(--border)] space-y-2">
              <label class="block space-y-1">
                <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dari</span>
                <input type="date" value={customFrom} oninput={onCustomFrom} class="input py-2 px-2.5 text-xs {customInvalid ? 'border-rose-400' : ''}" />
              </label>
              <label class="block space-y-1">
                <span class="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sampai</span>
                <input type="date" value={customTo} oninput={onCustomTo} class="input py-2 px-2.5 text-xs {customInvalid ? 'border-rose-400' : ''}" />
              </label>
              {#if customInvalid}
                <p class="text-[10px] font-medium text-rose-500">Tanggal "Sampai" harus setelah "Dari".</p>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="text-xs text-[var(--muted-foreground)] font-bold tracking-wide bg-slate-100/50 dark:bg-slate-900/30 border border-[var(--border)] w-fit px-3 py-1.5 rounded-lg shadow-sm">
    Ditemukan <span class="text-indigo-500 font-mono-data">{filtered.length}</span> Riwayat
  </div>

  <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
            <th class="px-5 py-4">Part</th>
            <th class="px-5 py-4">Kode</th>
            <th class="px-5 py-4">Vendor</th>
            <th class="px-5 py-4">Status</th>
            <th class="px-5 py-4">Akurasi</th>
            <th class="px-5 py-4">Waktu Pengerjaan</th>
            <th class="px-5 py-4 text-right">Detail</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-200">
          {#if loading && inspections.data.length === 0}
            {#each Array(8) as _row, i (i)}
              <tr class="animate-pulse" aria-hidden="true">
                <td class="px-5 py-3.5"><div class="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-5 w-14 rounded-full bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-4 w-12 rounded bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-4 w-36 rounded bg-slate-200 dark:bg-slate-700/50"></div></td>
                <td class="px-5 py-3.5"><div class="h-8 w-8 rounded-xl bg-slate-200 dark:bg-slate-700/50 ml-auto"></div></td>
              </tr>
            {/each}
          {:else}
          {#each paginated as row (row.id)}
            {@const isOK = row.status === 'OK'}
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-premium duration-150">
              <td class="px-5 py-3.5">
                <div class="font-semibold text-slate-900 dark:text-white">{row.partName}</div>
              </td>
              <td class="px-5 py-3.5 text-xs font-semibold font-mono-data text-slate-600 dark:text-slate-300">{row.partCode}</td>
              <td class="px-5 py-3.5 text-xs font-medium text-slate-600 dark:text-slate-300">{row.vendor}</td>
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
              {@const rowState = detailState[row.id] ?? { phase: 'idle' }}
              <tr>
                <td colspan="7" class="px-5 py-5 bg-slate-50/50 dark:bg-slate-900/20 border-t border-b border-[var(--border)]">
                  {#if rowState.phase === 'loading'}
                    <div class="w-full space-y-4 animate-pulse" aria-hidden="true">
                      <div class="h-12 w-full rounded-xl bg-slate-200 dark:bg-slate-700/60"></div>
                      <div class="flex flex-col lg:flex-row gap-4 items-start">
                        <div class="w-full lg:w-1/2 lg:shrink-0 aspect-video rounded-2xl bg-slate-200 dark:bg-slate-700/60"></div>
                        <div class="w-full lg:flex-1 space-y-4">
                          <div class="grid grid-cols-2 gap-2.5">
                            <div class="h-14 rounded-xl bg-slate-200 dark:bg-slate-700/60"></div>
                            <div class="h-14 rounded-xl bg-slate-200 dark:bg-slate-700/60"></div>
                          </div>
                          <div class="grid sm:grid-cols-2 gap-2.5">
                            {#each Array(4) as _placeholder, i (i)}
                              <div class="p-3 rounded-xl border border-[var(--border)] bg-slate-100 dark:bg-slate-800/40">
                                <div class="h-2.5 w-20 rounded bg-slate-200 dark:bg-slate-700/60"></div>
                                <div class="h-2.5 w-28 rounded bg-slate-200 dark:bg-slate-700/60 mt-2"></div>
                                <div class="h-8 w-full rounded bg-slate-200 dark:bg-slate-700/60 mt-3"></div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      </div>
                    </div>
                  {:else if rowState.phase === 'error'}
                    <div class="text-xs text-rose-500 font-bold py-6 text-center border border-rose-500/10 rounded-xl bg-rose-500/5">
                      {rowState.error ?? 'Gagal memuat detail inspeksi.'}
                    </div>
                  {:else if rowState.phase === 'loaded' && details[row.id]}
                    {@const detail = details[row.id]}
                    <div class="w-full space-y-4">
                      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-100/60 dark:bg-slate-900/40 border border-[var(--border)] px-3.5 py-2.5">
                        <div class="flex flex-col">
                          <span class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Operator</span>
                          <span class="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{detail.operatorName}</span>
                        </div>
                        <div class="flex flex-col">
                          <span class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Station</span>
                          <span class="text-xs font-bold text-slate-900 dark:text-white mt-0.5 font-mono-data">{detail.stationId}</span>
                        </div>
                        <div class="flex flex-col">
                          <span class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Waktu</span>
                          <span class="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{new Date(detail.timestamp).toLocaleString('id-ID')}</span>
                        </div>
                      </div>

                      <div class="flex flex-col lg:flex-row gap-4 items-start">
                        {#if detail.frameUrl}
                          {@const overlay = resolveEntryOverlay(detail.detections[0])}
                          <div
                            class="w-full lg:w-1/2 lg:shrink-0 relative {detailAspect[detail.id] ? '' : 'aspect-video'} rounded-2xl overflow-hidden shadow-lg border border-[var(--border)] bg-black"
                            style={detailAspect[detail.id] ? `aspect-ratio: ${detailAspect[detail.id]};` : ''}
                          >
                            <FrameThumbnail eventId={detail.id} initialUrl={detail.frameUrl} className="w-full h-full object-contain block" onAspect={(r) => { if (detailAspect[detail.id] !== r) detailAspect = { ...detailAspect, [detail.id]: r }; }} />
                            {#if overlay.positioned}
                              {#if overlay.box.polygon.length >= 3}
                                <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                  <polygon
                                    points={overlay.box.polygon.map((p) => `${p[0]},${p[1]}`).join(' ')}
                                    fill="none"
                                    stroke="rgba(0,0,0,0.65)"
                                    stroke-width="4.5"
                                    stroke-linejoin="round"
                                    vector-effect="non-scaling-stroke"
                                  />
                                  <polygon
                                    points={overlay.box.polygon.map((p) => `${p[0]},${p[1]}`).join(' ')}
                                    fill="none"
                                    stroke={overlay.box.status === 'OK' ? '#34d399' : '#fb7185'}
                                    stroke-width="2.5"
                                    stroke-linejoin="round"
                                    vector-effect="non-scaling-stroke"
                                  />
                                </svg>
                                <span
                                  class="absolute px-2 py-0.5 bg-slate-900/90 text-white text-[9px] font-bold rounded-lg border border-slate-700/20 whitespace-nowrap shadow-md pointer-events-none"
                                  style="left: {overlay.box.bbox.x}%; top: calc({overlay.box.bbox.y}% - 1.5rem);"
                                >
                                  {overlay.box.scanId}
                                </span>
                              {:else}
                              <div
                                class="absolute pointer-events-none border-2 {overlay.box.status === 'OK' ? 'border-emerald-400 bbox-ok' : 'border-rose-400 bbox-ng'}"
                                style="left: {overlay.box.bbox.x}%; top: {overlay.box.bbox.y}%; width: {overlay.box.bbox.width}%; height: {overlay.box.bbox.height}%;"
                              >
                                <span class="absolute -top-6 left-0 px-2 py-0.5 bg-slate-900/90 text-white text-[9px] font-bold rounded-lg border border-slate-700/20 whitespace-nowrap shadow-md">
                                  {overlay.box.scanId}
                                </span>
                              </div>
                              {/if}
                            {:else}
                              <div class="absolute bottom-0 inset-x-0 px-3 py-2 bg-slate-900/80 text-amber-300 text-[10px] font-bold tracking-wide text-center backdrop-blur-sm">
                                Bounding box tidak dapat diposisikan
                              </div>
                            {/if}
                          </div>
                        {/if}

                        <div class="w-full {detail.frameUrl ? 'lg:flex-1' : ''} space-y-4">
                          <div class="grid grid-cols-2 gap-2.5 text-center">
                            <div class="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-[var(--border)] p-2.5 shadow-sm">
                              <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Status</div>
                              <div class="text-sm font-extrabold mt-1.5 {detail.status === 'NG' ? 'text-rose-500' : 'text-emerald-500'}">
                                {detail.status}
                              </div>
                            </div>
                            <div class="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-[var(--border)] p-2.5 shadow-sm">
                              <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Akurasi</div>
                              <div class="text-sm font-extrabold text-slate-800 dark:text-slate-100 mt-1.5 font-mono-data">{detail.confidenceScore}%</div>
                            </div>
                          </div>

                          <div class="grid sm:grid-cols-2 gap-2.5">
                            {#each detail.measurements as measurement (measurement.dimensionName)}
                              {@const delta = measurement.measured - measurement.nominal}
                              {@const mOK = measurement.status === 'OK'}
                              <div class="rounded-xl border border-[var(--border)] p-3 bg-slate-50/20 dark:bg-slate-900/10 space-y-2.5">
                                <div class="flex items-start justify-between gap-3">
                                  <div>
                                    <div class="text-xs font-bold text-slate-800 dark:text-slate-100">{measurement.dimensionName}</div>
                                    <div class="text-[10px] text-[var(--muted-foreground)] font-medium mt-1">
                                      Toleransi: <span class="font-mono-data text-slate-700 dark:text-slate-300 font-semibold">{measurement.lowerLimit} - {measurement.upperLimit} {measurement.unit}</span>
                                    </div>
                                  </div>
                                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full {
                                    mOK
                                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
                                  }">
                                    {measurementStatusLabel(measurement.status)}
                                  </span>
                                </div>
                                <div class="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-400 font-mono-data">
                                  <div>
                                    <div class="text-[9px] text-[var(--muted-foreground)] tracking-wider uppercase font-sans mb-0.5">Measured</div>
                                    <div class="text-slate-900 dark:text-white font-bold">{measurement.measured} {measurement.unit}</div>
                                  </div>
                                  <div>
                                    <div class="text-[9px] text-[var(--muted-foreground)] tracking-wider uppercase font-sans mb-0.5">Nominal</div>
                                    <div class="text-slate-700 dark:text-slate-300 font-bold">{measurement.nominal} {measurement.unit}</div>
                                  </div>
                                  <div>
                                    <div class="text-[9px] text-[var(--muted-foreground)] tracking-wider uppercase font-sans mb-0.5">Delta</div>
                                    <div class="font-bold {Math.abs(delta) > 0 ? (mOK ? 'text-amber-500' : 'text-rose-500') : 'text-emerald-500'}">
                                      {delta > 0 ? '+' : ''}{delta.toFixed(3)} {measurement.unit}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      </div>
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
          {#if !loading && paginated.length === 0}
            <tr>
              <td colspan="7" class="px-5 py-16 text-center text-[var(--muted-foreground)] font-medium">
                {inspections.data.length === 0 ? 'Belum ada rekaman arsip data inspeksi.' : 'Tidak ditemukan baris data yang cocok dengan kriteria filter.'}
              </td>
            </tr>
          {/if}
          {/if}
        </tbody>
      </table>
    </div>
  </div>

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

  <ShareRecapModal
    open={shareOpen}
    filters={shareFilters}
    scopeLabel={scopeLabel}
    preview={sharePreview}
    onClose={() => (shareOpen = false)}
  />
</div>
