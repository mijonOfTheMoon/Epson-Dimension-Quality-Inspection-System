<script lang="ts">
  import { Activity, CheckCircle, Radio, TrendingDown, XCircle } from 'lucide-svelte';
  import { useDashboardSummary } from '$lib/hooks/useDashboardSummary.svelte';

  const summary = useDashboardSummary();

  const cards = $derived([
    { label: 'Inspeksi', value: summary.data.total, icon: Activity, color: 'blue' },
    { label: 'OK', value: summary.data.ok, icon: CheckCircle, color: 'green' },
    { label: 'NG', value: summary.data.ng, icon: XCircle, color: 'red' },
    { label: 'NG rate', value: `${summary.data.ngRate.toFixed(1)}%`, icon: TrendingDown, color: 'orange' },
    { label: 'Station aktif', value: `${summary.data.activeStationCount}/${summary.data.stationCount}`, icon: Radio, color: 'blue' },
  ]);

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  const totalDaily = $derived(summary.data.dailyTrend.reduce((acc, day) => Math.max(acc, day.ok + day.ng), 0) || 1);

  const maxStation = $derived(summary.data.stationTrend.reduce((acc, station) => Math.max(acc, station.ok + station.ng), 0) || 1);
  const maxPart = $derived(summary.data.partPareto.reduce((acc, part) => Math.max(acc, part.ok + part.ng), 0) || 1);
  const maxDrift = $derived(summary.data.measurementDrift.reduce((acc, drift) => Math.max(acc, Math.abs(drift.delta)), 0) || 1);
</script>

<div class="space-y-6">
  <div>
    <h1>Dashboard</h1>
    <p class="text-[var(--muted-foreground)] text-sm mt-1">Ringkasan kualitas hari ini.</p>
  </div>

  {#if summary.error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
      <span>{summary.error}</span>
      <button onclick={summary.reload} class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
    </div>
  {/if}

  {#if !summary.loading && !summary.error && summary.data.total === 0}
    <div class="bg-blue-50 border border-blue-200 text-blue-700 rounded-xl p-4 text-sm">
      Belum ada inspeksi.
    </div>
  {/if}

  <div class="grid grid-cols-2 xl:grid-cols-5 gap-4">
    {#each cards as card (card.label)}
      {@const Icon = card.icon}
      <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm text-[var(--muted-foreground)]">{card.label}</span>
          <div class="w-8 h-8 rounded-lg flex items-center justify-center {colorMap[card.color]}">
            <Icon class="w-4 h-4" />
          </div>
        </div>
        <div class="text-2xl" style="font-weight: 500">
          {#if summary.loading}
            <span class="inline-block w-12 h-7 bg-[var(--accent)] rounded animate-pulse"></span>
          {:else}
            {card.value}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="grid xl:grid-cols-2 gap-4">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <h3 class="mb-4">Tren harian</h3>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.dailyTrend.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada data.</div>
      {:else}
        <div class="space-y-2">
          {#each summary.data.dailyTrend as day (day.date)}
            <div>
              <div class="text-xs text-[var(--muted-foreground)] mb-1 flex justify-between">
                <span>{day.date.slice(5)}</span>
                <span>OK {day.ok} / NG {day.ng}</span>
              </div>
              <div class="flex gap-1 h-3">
                <div class="bg-green-500 rounded-sm" style="width: {(day.ok / totalDaily) * 100}%"></div>
                <div class="bg-red-500 rounded-sm" style="width: {(day.ng / totalDaily) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <h3 class="mb-4">Komposisi OK/NG</h3>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else}
        {@const total = summary.data.ok + summary.data.ng || 1}
        {@const okPct = (summary.data.ok / total) * 100}
        {@const ngPct = (summary.data.ng / total) * 100}
        <div class="flex items-center gap-6">
          <div class="relative w-32 h-32 rounded-full" style="background: conic-gradient(#22c55e {okPct}%, #ef4444 0 {okPct + ngPct}%)">
            <div class="absolute inset-3 rounded-full bg-[var(--card)] flex flex-col items-center justify-center">
              <div class="text-lg font-medium">{summary.data.total}</div>
              <div class="text-[10px] text-[var(--muted-foreground)]">Total</div>
            </div>
          </div>
          <div class="space-y-2 text-sm">
            <div class="flex items-center gap-2"><span class="w-3 h-3 bg-green-500 rounded-sm"></span> OK {summary.data.ok} ({okPct.toFixed(1)}%)</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 bg-red-500 rounded-sm"></span> NG {summary.data.ng} ({ngPct.toFixed(1)}%)</div>
          </div>
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <h3 class="mb-4">NG per part</h3>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.partPareto.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada data.</div>
      {:else}
        <div class="space-y-2">
          {#each summary.data.partPareto as part (part.partCode)}
            <div>
              <div class="text-xs text-[var(--muted-foreground)] mb-1 flex justify-between">
                <span>{part.partCode}</span>
                <span>NG {part.ng} / {part.total} ({part.ngRate}%)</span>
              </div>
              <div class="flex gap-1 h-3">
                <div class="bg-green-500 rounded-sm" style="width: {(part.ok / maxPart) * 100}%"></div>
                <div class="bg-red-500 rounded-sm" style="width: {(part.ng / maxPart) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <h3 class="mb-4">Station</h3>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.stationTrend.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada data station.</div>
      {:else}
        <div class="space-y-2">
          {#each summary.data.stationTrend as station (station.stationId)}
            <div>
              <div class="text-xs text-[var(--muted-foreground)] mb-1 flex justify-between">
                <span>{station.stationId}</span>
                <span>OK {station.ok} / NG {station.ng}</span>
              </div>
              <div class="flex gap-1 h-3">
                <div class="bg-green-500 rounded-sm" style="width: {(station.ok / maxStation) * 100}%"></div>
                <div class="bg-red-500 rounded-sm" style="width: {(station.ng / maxStation) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 xl:col-span-2">
      <h3 class="mb-4">Drift dimensi</h3>
      {#if summary.loading}
        <div class="h-[200px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.measurementDrift.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada data drift.</div>
      {:else}
        <div class="space-y-2">
          {#each summary.data.measurementDrift as drift (drift.dimensionName)}
            <div>
              <div class="text-xs text-[var(--muted-foreground)] mb-1 flex justify-between">
                <span>{drift.dimensionName}</span>
                <span>Delta {drift.delta.toFixed(3)} {drift.unit} (nominal {drift.nominal})</span>
              </div>
              <div class="h-3 bg-[var(--accent)] rounded-sm overflow-hidden">
                <div class="h-full {drift.delta >= 0 ? 'bg-purple-500' : 'bg-amber-500'}" style="width: {(Math.abs(drift.delta) / maxDrift) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
