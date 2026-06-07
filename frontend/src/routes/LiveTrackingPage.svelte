<script lang="ts">
  import {
    Camera, CheckCircle, Hand, Maximize2, Minimize2, MoreVertical, Play, RefreshCcw,
    RotateCcw, StopCircle, Trash2, Video, Zap,
  } from 'lucide-svelte';
  import CloudflareVideo from '$lib/components/CloudflareVideo.svelte';
  import { useInspections } from '$lib/hooks/useInspections.svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import { useStations } from '$lib/hooks/useStations.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import { auth } from '$lib/stores/auth.svelte';
  import { isSelected, measurementStatusLabel, nextSelection, resolveSelection, selectionPresent } from '$lib/utils/selection';
  import type { StationDetectionGroup } from '$lib/utils/selection';
  import type {
    DimensionView, ObjectDetection, PartType, StationPhase, StationStatusEvent,
  } from '$lib/types/api';

  interface MergedStation {
    stationId: string;
    online: boolean;
    running: boolean;
    fps?: number;
    phase?: StationPhase;
    activePartCode?: string;
    detections: ObjectDetection[];
  }

  type IconComponent = typeof StopCircle;
  const PHASE_LABELS: Record<StationPhase, { text: string; tone: string; icon: IconComponent }> = {
    idle: { text: 'Idle', tone: 'bg-slate-500/10 border border-slate-500/20 text-slate-500', icon: StopCircle },
    calibrating: { text: 'Kalibrasi', tone: 'bg-amber-500/10 border border-amber-500/20 text-amber-500', icon: RefreshCcw },
    ready: { text: 'Siap', tone: 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500', icon: Hand },
    stabilizing: { text: 'Deteksi', tone: 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-500', icon: Zap },
    locked: { text: 'Terkunci', tone: 'bg-violet-500/10 border border-violet-500/20 text-violet-500', icon: CheckCircle },
  };

  function mergeStations(stations: StationStatusEvent[]): MergedStation[] {
    const map = new Map<string, MergedStation>();
    for (const station of stations) {
      map.set(station.stationId, {
        stationId: station.stationId,
        online: station.state === 'online',
        running: Boolean(station.running),
        fps: station.fps,
        phase: station.phase,
        activePartCode: station.activePartCode,
        detections: station.detections ?? [],
      });
    }
    return [...map.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
  }

  const inspections = useInspections(40, 10000, 30000);
  const stations = useStations();
  const parts = useParts();

  let busy = $state<Record<string, boolean>>({});
  let toast = $state<{ text: string; tone: 'info' | 'error' } | null>(null);
  let selectedPart = $state<Record<string, string>>({});
  let inspectionView = $state<Record<string, DimensionView>>({});
  let pendingStart = $state<Record<string, boolean>>({});
  let focusedStationId = $state<string | null>(null);
  let menuStationId = $state<string | null>(null);
  let selectedDetectionKey = $state<{ stationId: string; detectionId: string } | null>(null);
  let videoPlaying = $state<Record<string, boolean>>({});
  const canControl = $derived(auth.user?.role === 'admin' || auth.user?.role === 'operator');
  const isAdmin = $derived(auth.user?.role === 'admin');

  const merged = $derived(mergeStations(stations.data));
  const visibleStations = $derived(focusedStationId ? merged.filter((s) => s.stationId === focusedStationId) : merged);
  const liveStationIds = $derived(
    new Set(
      merged
        .filter((s) => s.online && s.running)
        .map((s) => s.stationId),
    ),
  );

  const cameraLoading = $derived(stations.loading && merged.length === 0);
  const error = $derived(inspections.error || stations.error || parts.error);

  const selectionGroups = $derived.by(() => {
    const map = new Map<string, StationDetectionGroup>();
    for (const station of merged) {
      if (station.online && station.running && videoPlaying[station.stationId] && station.detections.length > 0) {
        map.set(station.stationId, { stationId: station.stationId, detections: station.detections });
      }
    }
    return map;
  });

  const selectedDetection = $derived(resolveSelection(selectedDetectionKey, selectionGroups));

  const partByCode = $derived.by(() => new Map(parts.data.map((part) => [part.partCode, part])));
  const defaultPartCode = $derived(parts.data[0]?.partCode ?? '');
  const partForCode = (partCode: string) => partByCode.get(partCode);
  const partCodeForStation = (station: MergedStation) => selectedPart[station.stationId] ?? station.activePartCode ?? defaultPartCode;
  const partSupportsSideOrientation = (part?: PartType) => part?.dimensions.some((dimension) => dimension.view === 'side') ?? false;
  const viewForStation = (stationId: string, part?: PartType): DimensionView => {
    const selected = inspectionView[stationId] ?? 'top';
    return partSupportsSideOrientation(part) ? selected : 'top';
  };

  const setPendingStart = (stationId: string, value: boolean) => {
    if (value) {
      pendingStart = { ...pendingStart, [stationId]: true };
      return;
    }
    if (!pendingStart[stationId]) return;
    const next = { ...pendingStart };
    delete next[stationId];
    pendingStart = next;
  };

  $effect(() => {
    const stationById = new Map(merged.map((station) => [station.stationId, station]));
    const next = { ...pendingStart };
    let changed = false;
    for (const stationId of Object.keys(next)) {
      const station = stationById.get(stationId);
      if (!station?.online || station.running) {
        delete next[stationId];
        changed = true;
      }
    }
    if (changed) pendingStart = next;
  });

  $effect(() => {
    if (selectedDetectionKey && !selectionPresent(selectedDetectionKey, selectionGroups)) {
      selectedDetectionKey = null;
    }
  });

  const showToast = (text: string, tone: 'info' | 'error' = 'info') => {
    toast = { text, tone };
    window.setTimeout(() => { toast = null; }, 2800);
  };

  const setSelectedPart = (stationId: string, partCode: string) => {
    selectedPart = { ...selectedPart, [stationId]: partCode };
    inspectionView = { ...inspectionView, [stationId]: 'top' };
  };

  const setInspectionView = (stationId: string, view: DimensionView) => {
    inspectionView = { ...inspectionView, [stationId]: view };
  };

  const refreshInspectionsSoon = () => {
    window.setTimeout(() => inspections.reload(), 1200);
  };

  const runCommand = async (
    stationId: string,
    label: string,
    fn: () => Promise<unknown>,
    onSuccess?: () => void,
  ) => {
    busy = { ...busy, [stationId]: true };
    try {
      await fn();
      showToast(`${label}: ${stationId}`);
      onSuccess?.();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      busy = { ...busy, [stationId]: false };
    }
  };

  const removeStation = async (stationId: string) => {
    busy = { ...busy, [stationId]: true };
    try {
      await api.deleteStation(stationId);
      if (focusedStationId === stationId) focusedStationId = null;
      if (selectedDetectionKey?.stationId === stationId) selectedDetectionKey = null;
      menuStationId = null;
      showToast(`Kamera dihapus dari tampilan: ${stationId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      busy = { ...busy, [stationId]: false };
    }
  };

  const retry = () => {
    inspections.reload();
    parts.reload();
  };

  const onlineCount = $derived(merged.filter((s) => s.online).length);
  const optimisticRunningCount = $derived(
    merged.filter((s) => s.running || pendingStart[s.stationId]).length,
  );

  let sessionStartedAt = $state<number | null>(null);

  $effect(() => {
    const active = optimisticRunningCount > 0;
    if (active) {
      if (sessionStartedAt === null) sessionStartedAt = Date.now();
    } else if (sessionStartedAt !== null) {
      sessionStartedAt = null;
    }
  });

  const sessionInspections = $derived.by(() => {
    const startedAt = sessionStartedAt;
    if (startedAt === null) return [];
    return inspections.data.filter((item) => Date.parse(item.timestamp) >= startedAt);
  });

  const sessionStats = $derived.by(() => {
    let total = 0, ok = 0, ng = 0;
    for (const item of sessionInspections) {
      total += 1;
      if (item.status === 'OK') ok += 1;
      else if (item.status === 'NG') ng += 1;
    }
    return { total, ok, ng, ngRate: total > 0 ? ((ng / total) * 100).toFixed(1) : '0.0' };
  });

  const measurements = $derived(selectedDetection?.measurements ?? []);
</script>

<div class="space-y-6 select-none font-sans">
  {#if toast}
    <div class="fixed top-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold text-white border animate-in fade-in slide-in-from-top-4 duration-300 {
      toast.tone === 'error' 
        ? 'bg-rose-600/95 border-rose-500/30 backdrop-blur-md shadow-rose-600/25' 
        : 'bg-indigo-600/95 border-indigo-500/30 backdrop-blur-md shadow-indigo-600/25'
    }">
      {toast.text}
    </div>
  {/if}

  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Live Tracking</h1>
    </div>
    <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold shadow-sm">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
        {onlineCount} Kamera Online
      </span>
      <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold shadow-sm">
        <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
        {optimisticRunningCount} Berjalan
      </span>
    </div>
  </div>

  {#if error}
    <div class="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl p-4.5 text-sm flex items-center justify-between gap-4 animate-in fade-in duration-200">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
        <span class="font-medium">{error}</span>
      </div>
      <button onclick={retry} class="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-colors">Coba lagi</button>
    </div>
  {/if}

  <div class="grid lg:grid-cols-[1fr_360px] gap-6">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm flex flex-col">
      <div class="flex items-center justify-between mb-4 border-b border-[var(--border)] pb-3">
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Feed Kamera Aktif</h3>
        <span class="text-xs text-[var(--muted-foreground)] font-semibold">
          {focusedStationId ? `Kamera Fokus: ${focusedStationId}` : `Total: ${merged.length} Stasiun`}
        </span>
      </div>

      {#if cameraLoading}
        <div class="grid sm:grid-cols-2 gap-4">
          {#each [0, 1] as i (i)}
            <div class="aspect-video bg-slate-100 dark:bg-slate-900 rounded-xl animate-pulse"></div>
          {/each}
        </div>
      {:else if merged.length === 0}
        <div class="text-center py-20 border border-dashed border-[var(--border)] rounded-2xl">
          <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-[var(--muted-foreground)] mb-4">
            <Video class="w-6 h-6 opacity-60" />
          </div>
          <p class="text-sm font-bold text-slate-800 dark:text-slate-200">Belum ada agent kamera terhubung</p>
          <p class="text-xs text-[var(--muted-foreground)] mt-2 max-w-sm mx-auto font-medium">Jalankan instruksi agent pada mesin inspeksi lokal untuk memulai visualisasi kamera.</p>
        </div>
      {:else}
        <div class={focusedStationId ? 'grid gap-6' : 'grid xl:grid-cols-2 gap-6'}>
          {#each visibleStations as station (station.stationId)}
            {@const isFocused = focusedStationId === station.stationId}
            {@const isBusy = busy[station.stationId]}
            {@const optimisticRunning = station.running || Boolean(pendingStart[station.stationId])}
            {@const phase = station.phase ?? (optimisticRunning ? 'calibrating' : 'idle')}
            {@const phaseMeta = PHASE_LABELS[phase]}
            {@const PhaseIcon = phaseMeta.icon}
            {@const partCode = partCodeForStation(station)}
            {@const selectedPartType = partForCode(partCode)}
            {@const activePart = partForCode(station.activePartCode ?? '') ?? selectedPartType}
            {@const hasSideOrientation = partSupportsSideOrientation(selectedPartType)}
            {@const view = viewForStation(station.stationId, selectedPartType)}
            {@const detections = liveStationIds.has(station.stationId) && videoPlaying[station.stationId] ? station.detections : []}

            <div class="border border-[var(--border)] rounded-2xl overflow-hidden flex flex-col bg-slate-50/30 dark:bg-slate-900/10 shadow-sm relative group/stream">
              <div class="aspect-video bg-slate-950 flex items-center justify-center relative {isFocused ? 'min-h-[480px]' : ''} overflow-hidden">
                <CloudflareVideo stationId={station.stationId} online={station.online} running={optimisticRunning} onPlayingChange={(p) => { videoPlaying = { ...videoPlaying, [station.stationId]: p }; }} />

                {#each detections as detection (detection.id)}
                  {@const selected = isSelected(selectedDetectionKey, station.stationId, detection.id)}
                  {@const isOK = detection.status === 'OK'}
                  <button
                    onclick={(event) => {
                      event.stopPropagation();
                      selectedDetectionKey = nextSelection({ stationId: station.stationId, detectionId: detection.id });
                    }}
                    class="absolute bg-transparent transition-all border-2 {selected ? 'ring-2 ring-white scale-[1.02] z-30' : 'z-20'} {isOK ? 'border-emerald-400 bbox-ok' : 'border-rose-400 bbox-ng'}"
                    style="left: {detection.bbox.x}%; top: {detection.bbox.y}%; width: {detection.bbox.width}%; height: {detection.bbox.height}%;"
                    title={`${detection.label} - Klik untuk statistik`}
                    aria-label={detection.label}
                  ></button>
                {/each}

                <div class="absolute top-3.5 left-3.5 flex flex-col gap-1.5 z-20">
                  <span class="text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md backdrop-blur-md {
                    station.online 
                      ? 'bg-emerald-500/90 text-white border border-emerald-400/20' 
                      : 'bg-rose-500/90 text-white border border-rose-400/20'
                  }">
                    {station.online ? 'CONNECTED' : 'OFFLINE'}
                  </span>
                  {#if optimisticRunning}
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md backdrop-blur-md inline-flex items-center gap-1 {phaseMeta.tone}">
                      <PhaseIcon class="w-3.5 h-3.5" />
                      {phaseMeta.text}
                    </span>
                  {/if}
                </div>

                <div class="absolute top-3.5 right-3.5 flex items-center gap-1.5 z-30">
                  {#if station.fps && optimisticRunning}
                    <span class="text-[10px] font-mono bg-slate-900/80 backdrop-blur-md text-slate-200 border border-slate-700/30 px-2.5 py-1 rounded-full shadow-md font-bold">{station.fps.toFixed(1)} FPS</span>
                  {/if}
                  <button
                    type="button"
                    onclick={() => focusedStationId = isFocused ? null : station.stationId}
                    title={isFocused ? 'Minimize' : 'Maximize'}
                    class="w-8 h-8 rounded-xl bg-slate-900/80 backdrop-blur-md text-white inline-flex items-center justify-center hover:bg-slate-800 transition-premium border border-slate-700/30 shadow-md"
                  >
                    {#if isFocused}
                      <Minimize2 class="w-4 h-4" />
                    {:else}
                      <Maximize2 class="w-4 h-4" />
                    {/if}
                  </button>
                  {#if isAdmin}
                  <div class="relative">
                    <button
                      type="button"
                      onclick={() => menuStationId = menuStationId === station.stationId ? null : station.stationId}
                      title="Menu kamera"
                      class="w-8 h-8 rounded-xl bg-slate-900/80 backdrop-blur-md text-white inline-flex items-center justify-center hover:bg-slate-800 transition-premium border border-slate-700/30 shadow-md"
                    >
                      <MoreVertical class="w-4 h-4" />
                    </button>
                    {#if menuStationId === station.stationId}
                      <div class="absolute right-0 mt-2 w-48 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl z-30 p-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
                        <button
                          type="button"
                          disabled={isBusy}
                          onclick={() => removeStation(station.stationId)}
                          class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs font-semibold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 class="w-4 h-4" /> Hapus kamera
                        </button>
                      </div>
                    {/if}
                  </div>
                  {/if}
                </div>
              </div>

              <div class="p-4 space-y-4 bg-[var(--card)] flex-1 flex flex-col justify-between">
                <div>
                  <div class="text-sm font-bold text-slate-800 dark:text-slate-100">{station.stationId}</div>
                  <div class="text-[11px] text-[var(--muted-foreground)] mt-1.5 font-medium truncate">
                    Target Part: <span class="text-slate-700 dark:text-slate-300 font-semibold">{activePart ? `${activePart.partName} (${activePart.partCode})` : 'Belum diatur'}</span>
                  </div>
                </div>

                {#if canControl}
                  {#if !optimisticRunning}
                    <div class={isFocused ? 'grid md:grid-cols-[minmax(0,1fr)_150px_140px] gap-2.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'}>
                      <select
                        disabled={!station.online || isBusy || parts.data.length === 0}
                        value={partCode}
                        onchange={(event) => setSelectedPart(station.stationId, (event.currentTarget as HTMLSelectElement).value)}
                        class="input text-xs font-medium {isFocused ? '' : 'sm:col-span-2'}"
                      >
                        {#if parts.data.length === 0}<option value="">Tidak ada part</option>{/if}
                        {#each parts.data as part (part.partCode)}
                          <option value={part.partCode}>{part.partName} ({part.partCode})</option>
                        {/each}
                      </select>
                      <select
                        disabled={!station.online || isBusy || !hasSideOrientation}
                        value={view}
                        onchange={(event) => setInspectionView(station.stationId, (event.currentTarget as HTMLSelectElement).value as DimensionView)}
                        class="input text-xs font-medium"
                      >
                        <option value="top">Menghadap Kamera</option>
                        <option value="side">Menyamping dari Kamera</option>
                      </select>
                      <button
                        disabled={!station.online || isBusy || !partCode}
                        onclick={() => runCommand(
                          station.stationId,
                          'Mulai',
                          () => api.startAgent(station.stationId, partCode, view),
                          () => {
                            setPendingStart(station.stationId, true);
                          },
                        )}
                        class="flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Play class="w-4 h-4 fill-white" /> Mulai
                      </button>
                    </div>
                  {:else}
                    <div class={isFocused ? 'grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2' : 'grid grid-cols-2 gap-2'}>
                      <select
                        disabled={!station.online || isBusy || !hasSideOrientation}
                        value={view}
                        onchange={(event) => setInspectionView(station.stationId, (event.currentTarget as HTMLSelectElement).value as DimensionView)}
                        class="input text-xs font-semibold {isFocused ? '' : 'col-span-2'}"
                      >
                        <option value="top">Menghadap Kamera</option>
                        <option value="side">Menyamping dari Kamera</option>
                      </select>
                      <button
                        disabled={!station.online || isBusy || phase === 'calibrating'}
                        onclick={() => runCommand(
                          station.stationId,
                          'Capture',
                          () => api.captureNow(station.stationId, view),
                          () => {
                            refreshInspectionsSoon();
                          },
                        )}
                        title="Simpan data inspeksi"
                        class="flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Camera class="w-4 h-4" /> Capture
                      </button>
                      <button
                        disabled={!station.online || isBusy}
                        onclick={() => runCommand(station.stationId, 'Kalibrasi', () => api.recalibrate(station.stationId))}
                        class="flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <RefreshCcw class="w-4 h-4 animate-in spin-in duration-300" /> Kalibrasi
                      </button>
                      <button
                        disabled={!station.online || isBusy}
                        onclick={() => runCommand(
                          station.stationId,
                          'Berhenti',
                          () => api.stopAgent(station.stationId),
                          () => {
                            setPendingStart(station.stationId, false);
                          },
                        )}
                        class="flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <StopCircle class="w-4 h-4" /> Stop
                      </button>
                    </div>
                  {/if}
                {:else}
                  <div class="text-xs text-[var(--muted-foreground)] font-semibold text-center py-2.5 border border-dashed border-[var(--border)] rounded-xl bg-slate-50/50 dark:bg-slate-900/10">
                    Mode Pemantauan &bull; Read Only
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="space-y-6">
      <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div class="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3 bg-slate-50/30 dark:bg-slate-900/10">
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Analisis Dimensi</h3>
            <p class="text-[10px] text-[var(--muted-foreground)] mt-1 font-medium truncate max-w-[160px]">
              {selectedDetection ? `Objek: ${selectedDetection.label}` : 'Pilih bounding box di kiri'}
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            {#if selectedDetection}
              <button
                type="button"
                onclick={() => {
                  selectedDetectionKey = null;
                }}
                class="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] transition-premium"
              >
                <RotateCcw class="w-3 h-3" /> Reset Box
              </button>
            {/if}
          </div>
        </div>

        <div class="p-4 space-y-4">
          <div class="grid grid-cols-2 gap-2.5 text-center">
            <div class="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-[var(--border)] p-2.5 shadow-sm">
              <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Status</div>
              <div class="text-sm font-extrabold mt-1.5 {
                selectedDetection?.status === 'NG' 
                  ? 'text-rose-500' 
                  : selectedDetection 
                    ? 'text-emerald-500' 
                    : 'text-[var(--muted-foreground)]'
              }">
                {selectedDetection?.status ?? '-'}
              </div>
            </div>
            <div class="rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-[var(--border)] p-2.5 shadow-sm">
              <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase">Akurasi</div>
              <div class="text-sm font-extrabold text-slate-800 dark:text-slate-100 mt-1.5 font-mono-data">
                {selectedDetection ? `${selectedDetection.confidenceScore}%` : '-'}
              </div>
            </div>
          </div>

          {#if measurements.length === 0}
            <div class="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--muted-foreground)] font-medium">
              Silakan klik salah satu kotak *bounding box* pada feed kamera untuk memuat perincian dimensi.
            </div>
          {:else}
            <div class="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {#each measurements as measurement (measurement.dimensionName)}
                {@const delta = measurement.measured - measurement.nominal}
                {@const statusLabel = measurementStatusLabel(measurement.status)}
                {@const isOK = measurement.status === 'OK'}
                <div class="rounded-xl border border-[var(--border)] p-3 bg-slate-50/20 dark:bg-slate-900/10 space-y-2.5">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-xs font-bold text-slate-800 dark:text-slate-100">{measurement.dimensionName}</div>
                      <div class="text-[10px] text-[var(--muted-foreground)] font-medium mt-1">
                        Toleransi: <span class="font-mono-data text-slate-700 dark:text-slate-300 font-semibold">{measurement.lowerLimit} - {measurement.upperLimit} {measurement.unit}</span>
                      </div>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full {
                      isOK 
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                        : 'bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400'
                    }">
                      {statusLabel}
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
                      <div class="font-bold {Math.abs(delta) > 0 ? (isOK ? 'text-amber-500' : 'text-rose-500') : 'text-emerald-500'}">
                        {delta > 0 ? '+' : ''}{delta.toFixed(3)} {measurement.unit}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div class="p-4 border-b border-[var(--border)] flex items-center justify-between bg-slate-50/30 dark:bg-slate-900/10">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">Sesi Saat Ini</h3>
          <span class="inline-flex px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{sessionInspections.length} Total</span>
        </div>
        
        <div class="grid grid-cols-3 gap-1 p-3.5 border-b border-[var(--border)] text-center font-mono-data shadow-inner bg-slate-50/10 dark:bg-slate-900/5">
          <div>
            <div class="text-lg font-extrabold text-slate-900 dark:text-white">{sessionStats.total}</div>
            <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase font-sans mt-0.5">Total</div>
          </div>
          <div>
            <div class="text-lg font-extrabold text-emerald-500">{sessionStats.ok}</div>
            <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase font-sans mt-0.5">OK</div>
          </div>
          <div>
            <div class="text-lg font-extrabold text-rose-500">{sessionStats.ngRate}%</div>
            <div class="text-[9px] text-[var(--muted-foreground)] font-bold tracking-wider uppercase font-sans mt-0.5">NG</div>
          </div>
        </div>

        <div class="p-4 space-y-3 max-h-[300px] overflow-y-auto scrollbar-thin">
          {#if sessionInspections.length === 0}
            <div class="text-center py-12 text-xs text-[var(--muted-foreground)] font-medium border border-dashed border-[var(--border)] rounded-xl">Belum ada aktivitas scan terdeteksi pada sesi ini.</div>
          {:else}
            {#each sessionInspections as inspection (inspection.id)}
              {@const isOK = inspection.status === 'OK'}
              <div class="p-3 rounded-xl border transition-all hover:-translate-y-[1px] hover:shadow-sm {
                isOK 
                  ? 'bg-emerald-500/5 border-emerald-500/10 dark:border-emerald-500/5' 
                  : 'bg-rose-500/5 border-rose-500/10 dark:border-rose-500/5'
              }">
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-2 h-2 rounded-full shrink-0 {isOK ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
                    <span class="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{inspection.partName}</span>
                  </div>
                  <span class="text-[10px] text-slate-400 font-bold shrink-0">{new Date(inspection.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="text-[10px] text-[var(--muted-foreground)] font-medium flex justify-between font-mono-data mt-1">
                  <span>Stasiun: {inspection.stationId}</span>
                  <span>Akurasi: {inspection.confidenceScore}%</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
