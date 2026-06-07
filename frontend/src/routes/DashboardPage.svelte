<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Activity, AlertTriangle, CheckCircle, Clock3, Crosshair, TrendingDown, XCircle, RefreshCw, ChevronRight } from 'lucide-svelte';
  import { useDashboardSummary } from '$lib/hooks/useDashboardSummary.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import ApexCharts from 'apexcharts';

  const summary = useDashboardSummary();

  const cards = $derived([
    { label: 'Inspeksi', value: summary.data.total, icon: Activity, color: 'indigo', desc: 'Total hasil scan' },
    { label: 'OK', value: summary.data.ok, icon: CheckCircle, color: 'emerald', desc: 'Dimensi sesuai batas' },
    { label: 'NG', value: summary.data.ng, icon: XCircle, color: 'rose', desc: 'Dimensi di luar batas' },
    { label: 'NG rate', value: `${summary.data.ngRate.toFixed(1)}%`, icon: TrendingDown, color: 'amber', desc: 'Rasio kegagalan' },
  ]);

  const colorMap: Record<string, { iconBg: string; text: string; ring: string; bgGradient: string }> = {
    indigo: { 
      iconBg: 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20', 
      text: 'text-indigo-600 dark:text-indigo-400',
      ring: 'group-hover:border-indigo-500/30',
      bgGradient: 'from-indigo-500/5 to-transparent'
    },
    emerald: { 
      iconBg: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20', 
      text: 'text-emerald-600 dark:text-emerald-400',
      ring: 'group-hover:border-emerald-500/30',
      bgGradient: 'from-emerald-500/5 to-transparent'
    },
    rose: { 
      iconBg: 'bg-rose-500/10 text-rose-500 border border-rose-500/20', 
      text: 'text-rose-600 dark:text-rose-400',
      ring: 'group-hover:border-rose-500/30',
      bgGradient: 'from-rose-500/5 to-transparent'
    },
    amber: { 
      iconBg: 'bg-amber-500/10 text-amber-500 border border-amber-500/20', 
      text: 'text-amber-600 dark:text-amber-400',
      ring: 'group-hover:border-amber-500/30',
      bgGradient: 'from-amber-500/5 to-transparent'
    },
  };

  const totalDaily = $derived(summary.data.dailyTrend.reduce((acc, day) => Math.max(acc, day.ok + day.ng), 0) || 1);

  let selectedPartCode = $state<string | null>(null);
  const problemParts = $derived(summary.data.problemParts);
  const selectedPart = $derived(
    problemParts.find((p) => p.partCode === selectedPartCode) ?? problemParts[0] ?? null
  );
  const maxPartNg = $derived(problemParts.reduce((acc, part) => Math.max(acc, part.ngRate), 0) || 1);

  type DimensionPoint = (typeof summary.data.problemParts)[number]['dimensions'][number];

  const fmtNum = (v: number) => String(Math.round(v * 1000) / 1000);

  const deviationInfo = (dim: DimensionPoint) => {
    if (dim.avgMeasured > dim.upperLimit) {
      return { status: 'over' as const, magnitude: dim.avgMeasured - dim.upperLimit };
    }
    if (dim.avgMeasured < dim.lowerLimit) {
      return { status: 'under' as const, magnitude: dim.lowerLimit - dim.avgMeasured };
    }
    return { status: 'ok' as const, magnitude: 0 };
  };

  const deviationStyles = {
    over: {
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
      marker: 'bg-amber-500',
    },
    under: {
      badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20',
      marker: 'bg-sky-500',
    },
    ok: {
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
      marker: 'bg-emerald-500',
    },
  } as const;

  const deviationLabel = (dim: DimensionPoint) => {
    const dev = deviationInfo(dim);
    if (dev.status === 'over') return `Oversize +${fmtNum(dev.magnitude)}${dim.unit}`;
    if (dev.status === 'under') return `Undersize -${fmtNum(dev.magnitude)}${dim.unit}`;
    return 'Dalam batas';
  };

  const bandGeometry = (dim: DimensionPoint) => {
    const span = Math.max(dim.upperLimit - dim.lowerLimit, 1e-9);
    const pad = span * 0.35;
    const min = Math.min(dim.lowerLimit - pad, dim.avgMeasured);
    const max = Math.max(dim.upperLimit + pad, dim.avgMeasured);
    const range = Math.max(max - min, 1e-9);
    const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / range) * 100));
    return {
      lowerPct: pct(dim.lowerLimit),
      upperPct: pct(dim.upperLimit),
      nominalPct: pct(dim.nominal),
      measuredPct: pct(dim.avgMeasured),
    };
  };

  const formatScanTime = (timestamp: string) => new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const relativeScanTime = (timestamp: string) => {
    const diffMs = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Baru saja';
    if (minutes < 60) return `${minutes} mnt lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    return `${Math.floor(hours / 24)} hr lalu`;
  };

  let dailyTrendChartEl = $state<HTMLDivElement | null>(null);
  let ratioChartEl = $state<HTMLDivElement | null>(null);
  let dailyTrendChartInstance: ApexCharts | null = null;
  let ratioChartInstance: ApexCharts | null = null;

  $effect(() => {
    const trendData = summary.data.dailyTrend;
    const okVal = summary.data.ok;
    const ngVal = summary.data.ng;
    const isDark = theme.mode === 'dark';
    const isLoading = summary.loading;

    if (isLoading) return;

    if (dailyTrendChartEl) {
      if (dailyTrendChartInstance) {
        dailyTrendChartInstance.destroy();
      }

      const categories = trendData.map((d) => d.date.slice(5));
      const okSeries = trendData.map((d) => d.ok);
      const ngSeries = trendData.map((d) => d.ng);

      const options = {
        chart: {
          type: 'area' as const,
          height: 260,
          toolbar: { show: false },
          background: 'transparent',
          fontFamily: "'Plus Jakarta Sans', sans-serif"
        },
        theme: {
          mode: (isDark ? 'dark' as const : 'light' as const)
        },
        colors: ['#10b981', '#ef4444'],
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth' as const, width: 2.5 },
        series: [
          { name: 'OK', data: okSeries },
          { name: 'NG', data: ngSeries }
        ],
        fill: {
          type: 'gradient' as const,
          gradient: {
            shadeIntensity: 1,
            opacityFrom: isDark ? 0.35 : 0.2,
            opacityTo: 0.01,
            stops: [0, 95, 100]
          }
        },
        xaxis: {
          categories,
          axisBorder: { show: false },
          axisTicks: { show: false },
          labels: {
            style: {
              colors: isDark ? '#94a3b8' : '#64748b',
              fontSize: '11px',
              fontWeight: 500
            }
          }
        },
        yaxis: {
          labels: {
            style: {
              colors: isDark ? '#94a3b8' : '#64748b',
              fontSize: '11px',
              fontWeight: 500
            }
          }
        },
        grid: {
          borderColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(148, 163, 184, 0.1)',
          strokeDashArray: 5
        },
        tooltip: {
          theme: (isDark ? 'dark' as const : 'light' as const),
          x: { show: true }
        }
      };

      dailyTrendChartInstance = new ApexCharts(dailyTrendChartEl, options);
      void dailyTrendChartInstance.render();
    }

    if (ratioChartEl) {
      if (ratioChartInstance) {
        ratioChartInstance.destroy();
      }

      const totalVal = okVal + ngVal;

      const options = {
        chart: {
          type: 'donut' as const,
          height: 260,
          background: 'transparent',
          fontFamily: "'Plus Jakarta Sans', sans-serif"
        },
        theme: {
          mode: (isDark ? 'dark' as const : 'light' as const)
        },
        colors: ['#10b981', '#ef4444'],
        labels: ['OK', 'NG'],
        series: [okVal, ngVal],
        plotOptions: {
          pie: {
            donut: {
              size: '72%',
              background: 'transparent',
              labels: {
                show: true,
                name: {
                  show: true,
                  fontSize: '13px',
                  fontWeight: 600,
                  color: isDark ? '#94a3b8' : '#64748b',
                  offsetY: -6
                },
                value: {
                  show: true,
                  fontSize: '24px',
                  fontWeight: 800,
                  color: isDark ? '#f8fafc' : '#0f172a',
                  offsetY: 6,
                  formatter: (val: string) => val
                },
                total: {
                  show: true,
                  label: 'Total Scan',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: isDark ? '#64748b' : '#94a3b8',
                  formatter: () => String(totalVal)
                }
              }
            }
          }
        },
        dataLabels: { enabled: false },
        legend: {
          position: 'bottom' as const,
          fontSize: '12px',
          fontWeight: 500,
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          labels: {
            colors: isDark ? '#94a3b8' : '#64748b'
          },
          markers: {
            radius: 4,
            onClick: () => {}
          }
        },
        stroke: {
          colors: [isDark ? '#0f172a' : '#ffffff'],
          width: 2.5
        },
        tooltip: {
          theme: (isDark ? 'dark' as const : 'light' as const)
        }
      };

      ratioChartInstance = new ApexCharts(ratioChartEl, options);
      void ratioChartInstance.render();
    }
  });

  onDestroy(() => {
    if (dailyTrendChartInstance) dailyTrendChartInstance.destroy();
    if (ratioChartInstance) ratioChartInstance.destroy();
  });
</script>

<div class="space-y-8 select-none">
  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Dashboard</h1>
    </div>
    <button 
      onclick={summary.reload} 
      class="inline-flex items-center justify-center gap-2 px-4 py-2 border border-[var(--border)] rounded-xl bg-[var(--card)] hover:bg-[var(--accent)] text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-sm hover:shadow active:scale-[0.98] transition-premium shrink-0 self-start"
    >
      <RefreshCw class="w-3.5 h-3.5" /> Reload Data
    </button>
  </div>

  {#if summary.error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl p-4.5 text-sm flex items-center justify-between gap-4 animate-in fade-in duration-200">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
        <span class="font-medium">{summary.error}</span>
      </div>
      <button onclick={summary.reload} class="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors">Coba lagi</button>
    </div>
  {/if}

  <div class="grid grid-cols-2 xl:grid-cols-4 gap-4.5">
    {#each cards as card (card.label)}
      {@const Icon = card.icon}
      {@const colorCfg = colorMap[card.color]}
      <div class="group bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 card-hover-effect relative overflow-hidden flex flex-col justify-between">
        <div class="absolute inset-0 bg-gradient-to-br {colorCfg.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
        <div class="flex items-center justify-between mb-4 relative z-10">
          <div class="flex flex-col">
            <span class="text-xs text-[var(--muted-foreground)] font-semibold tracking-wider uppercase">{card.label}</span>
            <span class="text-[10px] text-[var(--muted-foreground)] mt-0.5 font-medium">{card.desc}</span>
          </div>
          <div class="w-9 h-9 rounded-xl flex items-center justify-center {colorCfg.iconBg} transition-transform group-hover:scale-105">
            <Icon class="w-[18px] h-[18px]" />
          </div>
        </div>
        <div class="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 relative z-10" style="letter-spacing: -0.03em;">
          {#if summary.loading}
            <span class="inline-block w-16 h-8 bg-slate-200 dark:bg-slate-800 rounded-xl animate-pulse"></span>
          {:else}
            {card.value}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="grid xl:grid-cols-[1.8fr_1fr] gap-6">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Tren Kualitas Harian</h3>
        <span class="text-xs px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-full font-bold">Terakhir 7 Hari</span>
      </div>
      {#if summary.loading}
        <div class="h-[260px] bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse flex items-center justify-center text-xs text-[var(--muted-foreground)]">Membuat bagan tren...</div>
      {:else if summary.data.dailyTrend.length === 0}
        <div class="h-[260px] flex items-center justify-center border border-dashed border-[var(--border)] rounded-xl text-sm text-[var(--muted-foreground)] py-12">Belum ada data tren terkumpul.</div>
      {:else}
        <div bind:this={dailyTrendChartEl} class="w-full"></div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm flex flex-col justify-between">
      <div class="flex items-center justify-between mb-5">
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Komposisi OK vs NG</h3>
      </div>
      {#if summary.loading}
        <div class="h-[260px] bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse flex items-center justify-center text-xs text-[var(--muted-foreground)]">Membuat komposisi...</div>
      {:else}
        <div bind:this={ratioChartEl} class="w-full"></div>
      {/if}
    </div>
  </div>

  <div class="grid xl:grid-cols-2 gap-6">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="flex items-center gap-2.5 mb-5 border-b border-[var(--border)] pb-3">
        <div class="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center"><AlertTriangle class="w-4 h-4" /></div>
        <div class="min-w-0">
          <h3 class="text-base font-bold text-slate-900 dark:text-white">Part Paling Bermasalah</h3>
          <p class="text-[11px] text-[var(--muted-foreground)] font-medium">Pilih part untuk lihat dimensi penyebabnya</p>
        </div>
      </div>
      {#if summary.loading}
        <div class="space-y-4">
          {#each [1, 2, 3] as i (i)}
            <div class="h-14 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if problemParts.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-16 text-center border border-dashed border-[var(--border)] rounded-xl">Belum ada part bermasalah. Semua scan dalam batas.</div>
      {:else}
        <div class="space-y-2">
          {#each problemParts as part (part.partCode)}
            {@const active = selectedPart?.partCode === part.partCode}
            <button
              type="button"
              onclick={() => (selectedPartCode = part.partCode)}
              class="w-full text-left rounded-xl p-3 border transition-premium {active ? 'border-rose-500/40 bg-rose-500/5' : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-900/30'}"
            >
              <div class="text-xs mb-1.5 flex justify-between gap-3 font-semibold items-center">
                <span class="text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5 min-w-0">
                  <ChevronRight class="w-3.5 h-3.5 shrink-0 {active ? 'text-rose-500' : 'text-slate-400'}" />
                  <span class="truncate">{part.partName}</span>
                </span>
                <span class="text-rose-500 shrink-0 font-mono-data">{part.ngRate.toFixed(1)}% NG</span>
              </div>
              <div class="text-[11px] text-[var(--muted-foreground)] mb-2 flex justify-between gap-3 font-medium pl-5">
                <span class="truncate">Kode: {part.partCode}</span>
                <span class="shrink-0">Gagal {part.ng} dari {part.total} scan</span>
              </div>
              <div class="h-2 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden ml-5">
                <div class="h-full bg-rose-500 rounded-full transition-all duration-500" style="width: {(part.ngRate / maxPartNg) * 100}%"></div>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="flex items-center gap-2.5 mb-5 border-b border-[var(--border)] pb-3">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center"><Crosshair class="w-4 h-4" /></div>
        <div class="min-w-0">
          <h3 class="text-base font-bold text-slate-900 dark:text-white">Deviasi Dimensi</h3>
          {#if selectedPart}
            <p class="text-[11px] text-[var(--muted-foreground)] font-medium truncate">{selectedPart.partName} ({selectedPart.partCode})</p>
          {:else}
            <p class="text-[11px] text-[var(--muted-foreground)] font-medium">Rata-rata ukur vs batas toleransi</p>
          {/if}
        </div>
      </div>
      {#if summary.loading}
        <div class="space-y-5">
          {#each [1, 2, 3] as i (i)}
            <div class="h-16 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if !selectedPart || selectedPart.dimensions.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-16 text-center border border-dashed border-[var(--border)] rounded-xl">Belum ada data deviasi dimensi.</div>
      {:else}
        <div class="space-y-5">
          {#each selectedPart.dimensions as dim (dim.dimensionName)}
            {@const dev = deviationInfo(dim)}
            {@const geo = bandGeometry(dim)}
            <div>
              <div class="flex items-center justify-between gap-3 mb-2.5">
                <span class="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{dim.dimensionName}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 {deviationStyles[dev.status].badge}">{deviationLabel(dim)}</span>
              </div>
              <div class="relative h-7 mb-2">
                <div class="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800"></div>
                <div class="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-emerald-500/30" style="left:{geo.lowerPct}%; width:{Math.max(geo.upperPct - geo.lowerPct, 0)}%"></div>
                <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 rounded-full bg-emerald-500/70" style="left:{geo.lowerPct}%"></div>
                <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 rounded-full bg-emerald-500/70" style="left:{geo.upperPct}%"></div>
                <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-px h-4 bg-slate-400/60" style="left:{geo.nominalPct}%"></div>
                <div class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 shadow-sm {deviationStyles[dev.status].marker}" style="left:{geo.measuredPct}%"></div>
              </div>
              <div class="flex items-center justify-between gap-2 text-[10px] text-[var(--muted-foreground)] font-medium">
                <span class="font-mono-data">{fmtNum(dim.lowerLimit)}</span>
                <span class="font-mono-data text-slate-700 dark:text-slate-300 font-semibold">avg {fmtNum(dim.avgMeasured)} {dim.unit}</span>
                <span class="font-mono-data">{fmtNum(dim.upperLimit)}</span>
              </div>
              <div class="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-medium">
                <span class="text-rose-500 font-mono-data">{dim.ngCount} NG / {dim.totalCount} scan</span>
                {#if dim.unreadableCount > 0}
                  <span class="text-slate-400 dark:text-slate-500 font-mono-data">{dim.unreadableCount} tak terbaca</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm xl:col-span-2">
      <div class="flex items-center gap-2.5 mb-5 border-b border-[var(--border)] pb-3">
        <div class="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center"><Clock3 class="w-4 h-4" /></div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Aktivitas Scan Terbaru</h3>
      </div>
      {#if summary.loading}
        <div class="space-y-3">
          {#each [1, 2, 3] as i (i)}
            <div class="h-16 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if summary.data.recentInspections.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-16 text-center border border-dashed border-[var(--border)] rounded-xl">Belum ada riwayat aktivitas scan hari ini.</div>
      {:else}
        <div class="divide-y divide-[var(--border)] overflow-hidden">
          {#each summary.data.recentInspections as inspection (inspection.id)}
            <div class="flex items-center gap-3 py-4 first:pt-0 last:pb-0 px-2 rounded-xl hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-premium">
              <span class="inline-flex items-center justify-center w-11 py-1 rounded-full text-xs font-bold tracking-wide shrink-0 {
                inspection.status === 'OK' 
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                  : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
              }">
                {inspection.status}
              </span>
              <div class="flex-1 min-w-0 flex items-center gap-2">
                <span class="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{inspection.partName}</span>
                <span class="text-[10px] font-mono-data text-[var(--muted-foreground)] bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-md shrink-0">{inspection.partCode}</span>
              </div>
              <span class="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/40 border border-[var(--border)] px-2.5 py-1 rounded-lg font-mono-data">
                <Crosshair class="w-3 h-3 text-[var(--muted-foreground)]" /> {inspection.confidenceScore}%
              </span>
              <span class="hidden sm:inline-flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 border border-[var(--border)] px-2.5 py-1 rounded-lg">
                <Activity class="w-3 h-3 text-[var(--muted-foreground)]" /> {inspection.stationId}
              </span>
              <span class="inline-flex items-center gap-1 shrink-0 text-[11px] text-[var(--muted-foreground)] font-medium w-[88px] justify-end" title={formatScanTime(inspection.timestamp)}>
                <Clock3 class="w-3 h-3" /> {relativeScanTime(inspection.timestamp)}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
