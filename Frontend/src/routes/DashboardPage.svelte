<script lang="ts">
  import { Activity, AlertTriangle, CheckCircle, Clock3, ListChecks, TrendingDown, XCircle } from 'lucide-svelte';
  import { useDashboardSummary } from '$lib/hooks/useDashboardSummary.svelte';

  const summary = useDashboardSummary();

  const cards = $derived([
    { label: 'Inspeksi', value: summary.data.total, icon: Activity, color: 'blue' },
    { label: 'OK', value: summary.data.ok, icon: CheckCircle, color: 'green' },
    { label: 'NG', value: summary.data.ng, icon: XCircle, color: 'red' },
    { label: 'NG rate', value: `${summary.data.ngRate.toFixed(1)}%`, icon: TrendingDown, color: 'orange' },
  ]);

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  const totalDaily = $derived(summary.data.dailyTrend.reduce((acc, day) => Math.max(acc, day.ok + day.ng), 0) || 1);
  const maxFailingDimension = $derived(summary.data.failingDimensions.reduce((acc, item) => Math.max(acc, item.ngCount), 0) || 1);
  const maxPartRisk = $derived(summary.data.partRisk.reduce((acc, part) => Math.max(acc, part.ngRate), 0) || 1);

  const formatScanTime = (timestamp: string) => new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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

  <div class="grid grid-cols-2 xl:grid-cols-4 gap-4">
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
              <div class="text-xs text-[var(--muted-foreground)] mb-1 flex justify-between gap-3">
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
        <div class="flex flex-col sm:flex-row sm:items-center gap-6">
          <div
            class="relative w-32 h-32 rounded-full shrink-0"
            style:background={summary.data.total === 0 ? 'var(--accent)' : `conic-gradient(#22c55e ${okPct}%, #ef4444 0 ${okPct + ngPct}%)`}
          >
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
      <div class="flex items-center gap-2 mb-4">
        <AlertTriangle class="w-4 h-4 text-red-600" />
        <h3>Dimensi paling sering NG</h3>
      </div>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.failingDimensions.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada dimensi NG.</div>
      {:else}
        <div class="space-y-3">
          {#each summary.data.failingDimensions as item (`${item.partCode}-${item.dimensionName}`)}
            <div>
              <div class="text-xs mb-1 flex justify-between gap-3">
                <span class="font-medium truncate">{item.dimensionName}</span>
                <span class="text-[var(--muted-foreground)] shrink-0">NG {item.ngCount} / {item.totalCount}</span>
              </div>
              <div class="text-[11px] text-[var(--muted-foreground)] mb-1 truncate">{item.partName} ({item.partCode})</div>
              <div class="h-3 bg-[var(--accent)] rounded-sm overflow-hidden">
                <div class="h-full bg-red-500" style="width: {(item.ngCount / maxFailingDimension) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="flex items-center gap-2 mb-4">
        <ListChecks class="w-4 h-4 text-orange-600" />
        <h3>Part berisiko</h3>
      </div>
      {#if summary.loading}
        <div class="h-[260px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.partRisk.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada data part.</div>
      {:else}
        <div class="space-y-3">
          {#each summary.data.partRisk as part (part.partCode)}
            <div>
              <div class="text-xs mb-1 flex justify-between gap-3">
                <span class="font-medium truncate">{part.partName}</span>
                <span class="text-[var(--muted-foreground)] shrink-0">{part.ngRate.toFixed(1)}% NG</span>
              </div>
              <div class="text-[11px] text-[var(--muted-foreground)] mb-1 flex justify-between gap-3">
                <span>{part.partCode}</span>
                <span>NG {part.ng} dari {part.total} scan</span>
              </div>
              <div class="h-3 bg-[var(--accent)] rounded-sm overflow-hidden">
                <div class="h-full bg-orange-500" style="width: {(part.ngRate / maxPartRisk) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 xl:col-span-2">
      <div class="flex items-center gap-2 mb-4">
        <Clock3 class="w-4 h-4 text-blue-600" />
        <h3>Scan terbaru</h3>
      </div>
      {#if summary.loading}
        <div class="h-[220px] bg-[var(--accent)] rounded animate-pulse"></div>
      {:else if summary.data.recentInspections.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-12 text-center">Belum ada scan.</div>
      {:else}
        <div class="divide-y divide-[var(--border)]">
          {#each summary.data.recentInspections as inspection (inspection.id)}
            <div class="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[11px] px-2 py-0.5 rounded-full {inspection.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    {inspection.status}
                  </span>
                  <span class="text-sm font-medium truncate">{inspection.partName} ({inspection.partCode})</span>
                </div>
                <div class="text-xs text-[var(--muted-foreground)] mt-1">
                  {inspection.stationId} - {inspection.detections} objek - {formatScanTime(inspection.timestamp)}
                </div>
              </div>
              <div class="text-xs text-[var(--muted-foreground)] font-mono shrink-0">{inspection.id}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
