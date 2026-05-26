<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Activity, AlertTriangle, CheckCircle, Clock3, ListChecks, TrendingDown, XCircle, RefreshCw } from 'lucide-svelte';
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
  const maxFailingDimension = $derived(summary.data.failingDimensions.reduce((acc, item) => Math.max(acc, item.ngCount), 0) || 1);
  const maxPartRisk = $derived(summary.data.partRisk.reduce((acc, part) => Math.max(acc, part.ngRate), 0) || 1);

  const formatScanTime = (timestamp: string) => new Date(timestamp).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // ApexCharts bindings
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

    // Render Daily Trend Chart
    if (dailyTrendChartEl) {
      if (dailyTrendChartInstance) {
        dailyTrendChartInstance.destroy();
      }

      const categories = trendData.map((d) => d.date.slice(5)); // Extract MM-DD
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

    // Render Ratio Donut Chart
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
  <!-- Header Title -->
  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Dashboard</h1>
      <p class="text-[var(--muted-foreground)] text-sm mt-1.5 font-medium">Ringkasan kualitas dan analitik inspeksi dimensi hari ini.</p>
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

  <!-- KPI Metric Grid -->
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

  <!-- Charts Block -->
  <div class="grid xl:grid-cols-[1.8fr_1fr] gap-6">
    <!-- Area Chart (Tren Harian) -->
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

    <!-- Donut Chart (Komposisi) -->
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

  <!-- Industrial Tables & Statistics -->
  <div class="grid xl:grid-cols-2 gap-6">
    <!-- Failing Dimensions -->
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="flex items-center gap-2.5 mb-5 border-b border-[var(--border)] pb-3">
        <div class="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center"><AlertTriangle class="w-4 h-4" /></div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Dimensi Paling Sering NG</h3>
      </div>
      {#if summary.loading}
        <div class="space-y-4">
          {#each [1, 2, 3] as i (i)}
            <div class="h-14 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if summary.data.failingDimensions.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-16 text-center border border-dashed border-[var(--border)] rounded-xl">Belum ada penyimpangan dimensi yang terdeteksi.</div>
      {:else}
        <div class="space-y-4">
          {#each summary.data.failingDimensions as item (`${item.partCode}-${item.dimensionName}`)}
            <div class="group">
              <div class="text-xs mb-1.5 flex justify-between gap-3 font-semibold">
                <span class="text-slate-800 dark:text-slate-200 truncate">{item.dimensionName}</span>
                <span class="text-rose-500 shrink-0 font-mono-data">{item.ngCount} NG / {item.totalCount} scan</span>
              </div>
              <div class="text-[11px] text-[var(--muted-foreground)] mb-2 truncate font-medium">{item.partName} ({item.partCode})</div>
              <div class="h-2 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                <div class="h-full bg-rose-500 rounded-full transition-all duration-500" style="width: {(item.ngCount / maxFailingDimension) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Risky Parts -->
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div class="flex items-center gap-2.5 mb-5 border-b border-[var(--border)] pb-3">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center"><ListChecks class="w-4 h-4" /></div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Part Berisiko Tinggi</h3>
      </div>
      {#if summary.loading}
        <div class="space-y-4">
          {#each [1, 2, 3] as i (i)}
            <div class="h-14 bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if summary.data.partRisk.length === 0}
        <div class="text-sm text-[var(--muted-foreground)] py-16 text-center border border-dashed border-[var(--border)] rounded-xl">Belum ada data part terdaftar.</div>
      {:else}
        <div class="space-y-4">
          {#each summary.data.partRisk as part (part.partCode)}
            <div class="group">
              <div class="text-xs mb-1.5 flex justify-between gap-3 font-semibold">
                <span class="text-slate-800 dark:text-slate-200 truncate">{part.partName}</span>
                <span class="text-amber-500 shrink-0 font-mono-data">{part.ngRate.toFixed(1)}% NG</span>
              </div>
              <div class="text-[11px] text-[var(--muted-foreground)] mb-2 flex justify-between gap-3 font-medium">
                <span>Kode: {part.partCode}</span>
                <span>Gagal {part.ng} dari {part.total} scan</span>
              </div>
              <div class="h-2 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                <div class="h-full bg-amber-500 rounded-full transition-all duration-500" style="width: {(part.ngRate / maxPartRisk) * 100}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Recent Inspections (Full Width) -->
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
            <div class="py-4.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 px-2 rounded-xl transition-premium">
              <div class="min-w-0 flex items-start gap-3">
                <span class="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold tracking-wide shrink-0 {
                  inspection.status === 'OK' 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
                }">
                  {inspection.status}
                </span>
                <div class="min-w-0">
                  <span class="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{inspection.partName}</span>
                  <div class="text-[11px] text-[var(--muted-foreground)] mt-1.5 font-medium">
                    Kode: <span class="font-mono-data">{inspection.partCode}</span> &bull; {inspection.stationId} &bull; {inspection.detections} objek &bull; {formatScanTime(inspection.timestamp)}
                  </div>
                </div>
              </div>
              <div class="text-[11px] text-slate-400 dark:text-slate-500 font-mono-data bg-slate-50 dark:bg-slate-800/40 px-3 py-1 rounded-lg border border-[var(--border)] shrink-0 self-start sm:self-auto shadow-inner">{inspection.id}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
