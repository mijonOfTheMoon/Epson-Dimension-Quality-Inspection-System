<script lang="ts">
  import { Search, Download, ChevronDown, ChevronUp } from 'lucide-svelte';
  import { useInspections } from '$lib/hooks/useInspections.svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import FrameThumbnail from '$lib/components/FrameThumbnail.svelte';

  const inspections = useInspections(1000);
  const parts = useParts();

  let search = $state('');
  let statusFilter = $state<'all' | 'OK' | 'NG'>('all');
  let partFilter = $state('all');
  let expandedId = $state<string | null>(null);
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
  const paginated = $derived(filtered.slice((page - 1) * perPage, page * perPage));

  $effect(() => {
    if (page > totalPages) page = totalPages;
  });

  const exportCSV = () => {
    const headers = 'ID,Part,Part Code,Status,Operator,Station,Timestamp,Confidence,FrameUrl\n';
    const rows = filtered.map((r) =>
      `${r.id},${r.partName},${r.partCode},${r.status},${r.operatorName},${r.stationId},${r.timestamp},${r.confidenceScore},${r.frameUrl ?? ''}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
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
</script>

<div class="space-y-6">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1>Riwayat Inspeksi</h1>
      <p class="text-[var(--muted-foreground)] text-sm mt-1">Traceability data hasil inspeksi</p>
    </div>
    <button onclick={exportCSV} class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm self-start">
      <Download class="w-4 h-4" /> Export CSV
    </button>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
      <span>{error}</span>
      <button onclick={retry} class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
    </div>
  {/if}

  {#if loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat riwayat inspeksi dari backend...
    </div>
  {/if}

  <div class="flex flex-wrap gap-3">
    <div class="relative flex-1 min-w-[200px]">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
      <input
        value={search}
        oninput={onSearchInput}
        class="w-full pl-9 pr-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder="Cari ID, part, operator..."
      />
    </div>
    <select value={statusFilter} onchange={onStatusChange} class="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm">
      <option value="all">Semua Status</option>
      <option value="OK">OK</option>
      <option value="NG">NG</option>
    </select>
    <select value={partFilter} onchange={onPartChange} class="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm">
      <option value="all">Semua Part</option>
      {#each parts.data as part (part.id)}
        <option value={part.partCode}>{part.partName}</option>
      {/each}
    </select>
  </div>

  <div class="text-sm text-[var(--muted-foreground)]">{filtered.length} hasil ditemukan</div>

  <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-[var(--accent)]">
          <tr class="text-left">
            <th class="px-4 py-3">ID</th>
            <th class="px-4 py-3">Part</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Confidence</th>
            <th class="px-4 py-3">Station</th>
            <th class="px-4 py-3">Waktu</th>
            <th class="px-4 py-3">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each paginated as row (row.id)}
            <tr class="border-b border-[var(--border)] hover:bg-[var(--accent)]/50">
              <td class="px-4 py-2.5" style="font-weight: 500">{row.id}</td>
              <td class="px-4 py-2.5">
                <div>{row.partName}</div>
                <div class="text-xs text-[var(--muted-foreground)]">{row.partCode} | {row.vendor}</div>
              </td>
              <td class="px-4 py-2.5">
                <span class="px-2 py-0.5 rounded-full text-xs {row.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">{row.status}</span>
              </td>
              <td class="px-4 py-2.5">{row.confidenceScore}%</td>
              <td class="px-4 py-2.5">{row.stationId}</td>
              <td class="px-4 py-2.5 text-xs">{new Date(row.timestamp).toLocaleString('id-ID')}</td>
              <td class="px-4 py-2.5">
                <button onclick={() => expandedId = expandedId === row.id ? null : row.id} class="p-1 hover:bg-[var(--accent)] rounded" aria-label="Toggle detail">
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
                <td colspan="7" class="px-4 py-3 bg-[var(--accent)]">
                  <div class="text-xs" style="font-weight: 500">Detail Pengukuran - Operator: {row.operatorName}</div>
                  <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {#each row.measurements as measurement (measurement.dimensionName)}
                      <div class="p-2 rounded border {measurement.status === 'OK' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}">
                        <div class="text-xs text-[var(--muted-foreground)]">{measurement.dimensionName}</div>
                        <div class="text-sm" style="font-weight: 500">
                          <span class={measurement.status === 'OK' ? 'text-green-700' : 'text-red-700'}>{measurement.measured} {measurement.unit}</span>
                        </div>
                        <div class="text-[10px] text-[var(--muted-foreground)]">
                          Nominal: {measurement.nominal} | Range: {measurement.lowerLimit} ~ {measurement.upperLimit}
                        </div>
                      </div>
                    {/each}
                  </div>
                  {#if row.frameUrl}
                    <div class="mt-3 max-w-md">
                      <FrameThumbnail eventId={row.id} initialUrl={row.frameUrl} className="w-full" />
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
          {#if !loading && paginated.length === 0}
            <tr>
              <td colspan="7" class="px-4 py-12 text-center text-[var(--muted-foreground)]">
                {inspections.data.length === 0 ? 'Belum ada data inspeksi dari backend.' : 'Tidak ada data yang cocok dengan filter.'}
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  {#if totalPages > 1}
    <div class="flex items-center justify-center gap-2">
      <button disabled={page <= 1} onclick={() => page -= 1} class="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm disabled:opacity-50">Prev</button>
      <span class="text-sm text-[var(--muted-foreground)]">{page} / {totalPages}</span>
      <button disabled={page >= totalPages} onclick={() => page += 1} class="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm disabled:opacity-50">Next</button>
    </div>
  {/if}
</div>
