<script lang="ts">
  import {
    Camera, CheckCircle, Hand, Maximize2, Minimize2, MoreVertical, Play, RefreshCcw,
    RotateCcw, StopCircle, Trash2, Video, XCircle, Zap,
  } from 'lucide-svelte';
  import { useAgents } from '$lib/hooks/useAgents.svelte';
  import { useFrameStream } from '$lib/hooks/useFrameStream.svelte';
  import { useInspections } from '$lib/hooks/useInspections.svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import { useStations } from '$lib/hooks/useStations.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import { auth } from '$lib/stores/auth.svelte';
  import type {
    AgentInfo, DimensionView, InspectionResult, ObjectDetection, PartType, StationPhase, StationStatusEvent,
  } from '$lib/types/api';

  interface MergedStation {
    stationId: string;
    online: boolean;
    running: boolean;
    fps?: number;
    phase?: StationPhase;
    activePartCode?: string;
  }

  interface StationInspectionGroup {
    latest: InspectionResult;
    detections: ObjectDetection[];
  }

  type IconComponent = typeof StopCircle;
  const BOXES_DISABLED_KEY = 'diminspect_live_tracking_boxes_disabled';
  const PHASE_LABELS: Record<StationPhase, { text: string; tone: string; icon: IconComponent }> = {
    idle: { text: 'Idle', tone: 'bg-gray-100 text-gray-700', icon: StopCircle },
    calibrating: { text: 'Kalibrasi', tone: 'bg-amber-100 text-amber-700', icon: RefreshCcw },
    ready: { text: 'Siap', tone: 'bg-blue-100 text-blue-700', icon: Hand },
    stabilizing: { text: 'Deteksi', tone: 'bg-purple-100 text-purple-700', icon: Zap },
    locked: { text: 'Terkunci', tone: 'bg-green-100 text-green-700', icon: CheckCircle },
  };

  function mergeStations(agents: AgentInfo[], stations: StationStatusEvent[]): MergedStation[] {
    const map = new Map<string, MergedStation>();
    for (const station of stations) {
      map.set(station.stationId, {
        stationId: station.stationId,
        online: station.state === 'online',
        running: Boolean(station.running),
        fps: station.fps,
        phase: station.phase,
        activePartCode: station.activePartCode,
      });
    }
    for (const agent of agents) {
      const existing = map.get(agent.stationId);
      map.set(agent.stationId, {
        stationId: agent.stationId,
        online: agent.online,
        running: agent.running,
        fps: existing?.fps,
        phase: agent.online ? (existing?.phase ?? 'idle') : 'idle',
        activePartCode: existing?.activePartCode,
      });
    }
    return [...map.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
  }

  const readBoxesDisabled = () => {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(BOXES_DISABLED_KEY) === 'true';
    } catch {
      return false;
    }
  };

  const persistBoxesDisabled = (value: boolean) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(BOXES_DISABLED_KEY, value ? 'true' : 'false');
    } catch {
      // Ignore storage failures; the in-memory state still hides the boxes for this session.
    }
  };

  const inspections = useInspections(40);
  const stations = useStations();
  const agents = useAgents();
  const parts = useParts();

  let busy = $state<Record<string, boolean>>({});
  let toast = $state<{ text: string; tone: 'info' | 'error' } | null>(null);
  let selectedPart = $state<Record<string, string>>({});
  let inspectionView = $state<Record<string, DimensionView>>({});
  let focusedStationId = $state<string | null>(null);
  let menuStationId = $state<string | null>(null);
  let selectedDetectionKey = $state<{ stationId: string; detectionId: string } | null>(null);
  let boxesDisabled = $state(readBoxesDisabled());
  const canControl = $derived(auth.user?.role === 'admin' || auth.user?.role === 'operator');

  const merged = $derived(mergeStations(agents.data, stations.data));
  const visibleStations = $derived(focusedStationId ? merged.filter((s) => s.stationId === focusedStationId) : merged);
  const visibleIds = $derived(visibleStations.map((s) => s.stationId));
  const frameStream = useFrameStream(() => visibleIds);

  const latestInspections = $derived(inspections.data.slice(0, 10));
  const loading = $derived(inspections.loading || stations.loading || agents.loading || parts.loading);
  const error = $derived(inspections.error || stations.error || agents.error || parts.error);

  const latestGroupsByStation = $derived.by(() => {
    const map = new Map<string, StationInspectionGroup>();
    for (const inspection of inspections.data) {
      const group = map.get(inspection.stationId);
      if (!group) {
        map.set(inspection.stationId, { latest: inspection, detections: [...inspection.detections] });
      } else if (group.latest.timestamp === inspection.timestamp) {
        group.detections.push(...inspection.detections);
      }
    }
    return map;
  });

  const selectedDetection = $derived.by(() => {
    const key = selectedDetectionKey;
    if (!key) return null;
    const group = latestGroupsByStation.get(key.stationId);
    return group?.detections.find((item) => item.id === key.detectionId) ?? null;
  });

  const partByCode = $derived.by(() => new Map(parts.data.map((part) => [part.partCode, part])));
  const defaultPartCode = $derived(parts.data[0]?.partCode ?? '');
  const partForCode = (partCode: string) => partByCode.get(partCode);
  const partCodeForStation = (station: MergedStation) => selectedPart[station.stationId] ?? station.activePartCode ?? defaultPartCode;
  const partSupportsSideView = (part?: PartType) => part?.dimensions.some((dimension) => dimension.view === 'side') ?? false;
  const viewForStation = (stationId: string, part?: PartType): DimensionView => {
    const selected = inspectionView[stationId] ?? 'top';
    return partSupportsSideView(part) ? selected : 'top';
  };

  let latestHandledInspectionId: string | null = null;
  $effect(() => {
    const latest = inspections.data[0];
    if (!latest) return;
    if (latest.id === latestHandledInspectionId) return;
    latestHandledInspectionId = latest.id;
    if (boxesDisabled) {
      selectedDetectionKey = null;
      return;
    }
    if (latest.detections[0]) {
      selectedDetectionKey = { stationId: latest.stationId, detectionId: latest.detections[0].id };
    } else {
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
      await agents.refresh();
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
      stations.reload();
      await agents.refresh();
      showToast(`Cam dihapus dari tampilan: ${stationId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      busy = { ...busy, [stationId]: false };
    }
  };

  const retry = () => {
    inspections.reload();
    stations.reload();
    agents.reload();
    parts.reload();
  };

  const onlineCount = $derived(merged.filter((s) => s.online).length);
  const runningCount = $derived(merged.filter((s) => s.running).length);

  const sessionStats = $derived.by(() => {
    let total = 0, ok = 0, ng = 0;
    for (const item of latestInspections) {
      total += 1;
      if (item.status === 'OK') ok += 1;
      else if (item.status === 'NG') ng += 1;
    }
    return { total, ok, ng, ngRate: total > 0 ? ((ng / total) * 100).toFixed(1) : '0.0' };
  });

  const measurements = $derived(selectedDetection?.measurements ?? []);
  const okCount = $derived(measurements.filter((item) => item.status === 'OK').length);
  const ngCount = $derived(measurements.filter((item) => item.status !== 'OK').length);
</script>

<div class="space-y-4">
  {#if toast}
    <div class="fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white {toast.tone === 'error' ? 'bg-red-600' : 'bg-blue-600'}">
      {toast.text}
    </div>
  {/if}

  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1>Live Tracking</h1>
      <p class="text-[var(--muted-foreground)] text-sm mt-1">
        Streaming berjalan terus. Data masuk saat operator menekan Capture.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="px-2 py-1 rounded-full bg-green-100 text-green-700">{onlineCount} Online</span>
      <span class="px-2 py-1 rounded-full bg-blue-100 text-blue-700">{runningCount} Running</span>
    </div>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
      <span>{error}</span>
      <button onclick={retry} class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
    </div>
  {/if}

  <div class="grid lg:grid-cols-[1fr_360px] gap-4">
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm">Kamera</h3>
        <span class="text-xs text-[var(--muted-foreground)]">
          {focusedStationId ? `Focus: ${focusedStationId}` : `${merged.length} station`}
        </span>
      </div>

      {#if loading && merged.length === 0}
        <div class="grid sm:grid-cols-2 gap-3">
          {#each [0, 1] as i (i)}
            <div class="h-72 bg-[var(--accent)] rounded animate-pulse"></div>
          {/each}
        </div>
      {:else if merged.length === 0}
        <div class="text-center py-12 text-[var(--muted-foreground)]">
          <Video class="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p class="text-sm">Belum ada agent yang terhubung.</p>
          <p class="text-xs mt-1">Jalankan agent di mesin local untuk mulai streaming.</p>
        </div>
      {:else}
        <div class={focusedStationId ? 'grid gap-4' : 'grid xl:grid-cols-2 gap-4'}>
          {#each visibleStations as station (station.stationId)}
            {@const isFocused = focusedStationId === station.stationId}
            {@const frameUrl = frameStream.frames[station.stationId]}
            {@const isBusy = busy[station.stationId]}
            {@const phase = station.phase ?? (station.running ? 'ready' : 'idle')}
            {@const phaseMeta = PHASE_LABELS[phase]}
            {@const PhaseIcon = phaseMeta.icon}
            {@const partCode = partCodeForStation(station)}
            {@const selectedPartType = partForCode(partCode)}
            {@const activePart = partForCode(station.activePartCode ?? '') ?? selectedPartType}
            {@const hasSideView = partSupportsSideView(selectedPartType)}
            {@const view = viewForStation(station.stationId, selectedPartType)}
            {@const latestGroup = latestGroupsByStation.get(station.stationId)}
            {@const detections = boxesDisabled ? [] : (latestGroup?.detections ?? [])}

            <div class="border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
              <div class="aspect-video bg-black flex items-center justify-center relative {isFocused ? 'min-h-[480px]' : ''}">
                {#if station.running && frameUrl}
                  <img src={frameUrl} alt={station.stationId} class="w-full h-full object-contain" />
                {:else}
                  <div class="text-gray-500 text-xs flex flex-col items-center">
                    <Video class="w-8 h-8 mb-2 opacity-50" />
                    {station.online ? (station.running ? 'Menunggu frame...' : 'Idle - pilih part lalu klik Mulai') : 'Agent offline'}
                  </div>
                {/if}

                {#each detections as detection (detection.id)}
                  {@const selected = selectedDetectionKey?.stationId === station.stationId && selectedDetectionKey.detectionId === detection.id}
                  <button
                    onclick={(event) => {
                      event.stopPropagation();
                      selectedDetectionKey = { stationId: station.stationId, detectionId: detection.id };
                    }}
                    class="absolute bg-transparent {selected ? 'border-4 ring-2 ring-white z-20' : 'border-2 z-10'} {detection.status === 'OK' ? 'border-green-400' : 'border-red-400'}"
                    style="left: {detection.bbox.x}%; top: {detection.bbox.y}%; width: {detection.bbox.width}%; height: {detection.bbox.height}%;"
                    title={detection.label}
                    aria-label={detection.label}
                  ></button>
                {/each}

                <div class="absolute top-2 left-2 flex flex-col gap-1">
                  <span class="text-[10px] px-2 py-0.5 rounded-full {station.online ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}">
                    {station.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                  {#if station.running}
                    <span class="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 {phaseMeta.tone}">
                      <PhaseIcon class="w-3 h-3" />
                      {phaseMeta.text}
                    </span>
                  {/if}
                </div>

                <div class="absolute top-2 right-2 flex items-center gap-1">
                  {#if station.fps && station.running}
                    <span class="text-[10px] bg-black/60 text-white px-2 py-1 rounded-full">{station.fps.toFixed(1)} FPS</span>
                  {/if}
                  <button
                    type="button"
                    onclick={() => focusedStationId = isFocused ? null : station.stationId}
                    title={isFocused ? 'Minimize' : 'Maximize'}
                    class="w-8 h-8 rounded-full bg-black/60 text-white inline-flex items-center justify-center hover:bg-black/80"
                  >
                    {#if isFocused}
                      <Minimize2 class="w-4 h-4" />
                    {:else}
                      <Maximize2 class="w-4 h-4" />
                    {/if}
                  </button>
                  <div class="relative">
                    <button
                      type="button"
                      onclick={() => menuStationId = menuStationId === station.stationId ? null : station.stationId}
                      title="Menu camera"
                      class="w-8 h-8 rounded-full bg-black/60 text-white inline-flex items-center justify-center hover:bg-black/80"
                    >
                      <MoreVertical class="w-4 h-4" />
                    </button>
                    {#if menuStationId === station.stationId}
                      <div class="absolute right-0 mt-2 w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg z-30 p-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onclick={() => removeStation(station.stationId)}
                          class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 class="w-4 h-4" /> Hapus dari tampilan
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="p-3 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm truncate" style="font-weight: 500">{station.stationId}</div>
                    <div class="text-[11px] text-[var(--muted-foreground)] truncate">
                      {activePart ? `${activePart.partName} - ${activePart.partCode}` : 'Belum ada part'}
                    </div>
                  </div>
                </div>

                {#if canControl}
                  {#if !station.running}
                    <div class={isFocused ? 'grid md:grid-cols-[minmax(0,1fr)_140px_120px] gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
                      <select
                        disabled={!station.online || isBusy || parts.data.length === 0}
                        value={partCode}
                        onchange={(event) => setSelectedPart(station.stationId, (event.currentTarget as HTMLSelectElement).value)}
                        class="min-w-0 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50 {isFocused ? '' : 'sm:col-span-2'}"
                      >
                        {#if parts.data.length === 0}<option value="">Tidak ada part</option>{/if}
                        {#each parts.data as part (part.partCode)}
                          <option value={part.partCode}>{part.partName} ({part.partCode})</option>
                        {/each}
                      </select>
                      <select
                        disabled={!station.online || isBusy || !hasSideView}
                        value={view}
                        onchange={(event) => setInspectionView(station.stationId, (event.currentTarget as HTMLSelectElement).value as DimensionView)}
                        class="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                      >
                        <option value="top">Tampak Atas</option>
                        <option value="side">Tampak Samping</option>
                      </select>
                      <button
                        disabled={!station.online || isBusy || !partCode}
                        onclick={() => runCommand(station.stationId, 'Mulai', () => api.startAgent(station.stationId, partCode, view))}
                        class="flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Play class="w-3.5 h-3.5" /> Mulai
                      </button>
                    </div>
                  {:else}
                    <div class={isFocused ? 'grid grid-cols-[1fr_1fr_1fr_1fr] gap-1.5' : 'grid grid-cols-2 gap-1.5'}>
                      <select
                        disabled={!station.online || isBusy || !hasSideView}
                        value={view}
                        onchange={(event) => setInspectionView(station.stationId, (event.currentTarget as HTMLSelectElement).value as DimensionView)}
                        class="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50 {isFocused ? '' : 'col-span-2'}"
                      >
                        <option value="top">Atas</option>
                        <option value="side">Samping</option>
                      </select>
                      <button
                        disabled={!station.online || isBusy || phase === 'calibrating'}
                        onclick={() => runCommand(
                          station.stationId,
                          'Capture',
                          () => api.captureNow(station.stationId, view),
                          refreshInspectionsSoon,
                        )}
                        title="Simpan inspeksi sekarang"
                        class="flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Camera class="w-3.5 h-3.5" /> Capture
                      </button>
                      <button
                        disabled={!station.online || isBusy}
                        onclick={() => runCommand(station.stationId, 'Kalibrasi', () => api.recalibrate(station.stationId))}
                        class="flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500 text-white rounded-lg text-xs hover:bg-amber-600 disabled:opacity-50"
                      >
                        <RefreshCcw class="w-3.5 h-3.5" /> Kalibrasi
                      </button>
                      <button
                        disabled={!station.online || isBusy}
                        onclick={() => runCommand(station.stationId, 'Berhenti', () => api.stopAgent(station.stationId))}
                        class="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700 disabled:opacity-50"
                      >
                        <StopCircle class="w-3.5 h-3.5" /> Stop
                      </button>
                    </div>
                  {/if}
                {:else}
                  <div class="text-xs text-[var(--muted-foreground)] text-center py-2 border border-dashed border-[var(--border)] rounded-lg">
                    Mode Pemantauan Saja
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="space-y-4">
      <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div class="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm">Stats Dimensi</h3>
            <p class="text-xs text-[var(--muted-foreground)] mt-0.5">
              {selectedDetection ? selectedDetection.label : 'Pilih bounding box untuk melihat detail'}
            </p>
          </div>
          <button
            type="button"
            onclick={() => {
              selectedDetectionKey = null;
              boxesDisabled = true;
              persistBoxesDisabled(true);
            }}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs hover:bg-[var(--accent)]"
          >
            <RotateCcw class="w-3.5 h-3.5" /> Reset
          </button>
        </div>

        <div class="p-4 space-y-3">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-[var(--accent)] p-3">
              <div class="text-[11px] text-[var(--muted-foreground)]">Status</div>
              <div class="text-lg font-medium {selectedDetection?.status === 'NG' ? 'text-red-600' : selectedDetection ? 'text-green-600' : 'text-[var(--muted-foreground)]'}">
                {selectedDetection?.status ?? '-'}
              </div>
            </div>
            <div class="rounded-lg bg-[var(--accent)] p-3">
              <div class="text-[11px] text-[var(--muted-foreground)]">Confidence</div>
              <div class="text-lg font-medium">{selectedDetection ? `${selectedDetection.confidenceScore}%` : '-'}</div>
            </div>
            <div class="rounded-lg bg-[var(--accent)] p-3">
              <div class="text-[11px] text-[var(--muted-foreground)]">OK / NG</div>
              <div class="text-lg font-medium"><span class="text-green-600">{okCount}</span> / <span class="text-red-600">{ngCount}</span></div>
            </div>
          </div>

          {#if measurements.length === 0}
            <div class="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
              Belum ada dimensi yang dipilih.
            </div>
          {:else}
            <div class="space-y-2">
              {#each measurements as measurement (measurement.dimensionName)}
                {@const delta = measurement.measured - measurement.nominal}
                {@const statusLabel = measurement.status === 'UNREADABLE' ? 'Tidak terbaca' : measurement.status}
                <div class="rounded-lg border border-[var(--border)] p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-sm font-medium">{measurement.dimensionName}</div>
                      <div class="text-[11px] text-[var(--muted-foreground)]">
                        Toleransi {measurement.lowerLimit} - {measurement.upperLimit} {measurement.unit}
                      </div>
                    </div>
                    <span class="text-[11px] px-2 py-0.5 rounded-full {measurement.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                      {statusLabel}
                    </span>
                  </div>
                  <div class="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div><div class="text-[var(--muted-foreground)]">Measured</div><div class="font-medium">{measurement.measured} {measurement.unit}</div></div>
                    <div><div class="text-[var(--muted-foreground)]">Nominal</div><div class="font-medium">{measurement.nominal} {measurement.unit}</div></div>
                    <div><div class="text-[var(--muted-foreground)]">Delta</div><div class="font-medium {Math.abs(delta) > 0 ? 'text-amber-700' : ''}">{delta.toFixed(3)} {measurement.unit}</div></div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div class="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 class="text-sm">Sesi ini</h3>
          <span class="text-xs text-[var(--muted-foreground)]">{latestInspections.length} data</span>
        </div>
        <div class="grid grid-cols-3 gap-2 p-4 border-b border-[var(--border)] text-center text-sm">
          <div><div class="text-xl font-medium">{sessionStats.total}</div><div class="text-xs text-[var(--muted-foreground)]">Total</div></div>
          <div><div class="text-xl font-medium text-green-600">{sessionStats.ok}</div><div class="text-xs text-[var(--muted-foreground)]">OK</div></div>
          <div><div class="text-xl font-medium text-red-600">{sessionStats.ngRate}%</div><div class="text-xs text-[var(--muted-foreground)]">NG</div></div>
        </div>
        <div class="p-4 space-y-3 max-h-[420px] overflow-y-auto">
          {#if latestInspections.length === 0}
            <div class="text-center py-8 text-[var(--muted-foreground)] text-sm">Belum ada event inspeksi.</div>
          {:else}
            {#each latestInspections as inspection (inspection.id)}
              <div class="p-3 rounded-lg border {inspection.status === 'OK' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    {#if inspection.status === 'OK'}
                      <CheckCircle class="w-4 h-4 text-green-600" />
                    {:else}
                      <XCircle class="w-4 h-4 text-red-600" />
                    {/if}
                    <span class="text-sm" style="font-weight: 500">{inspection.partName} ({inspection.partCode})</span>
                  </div>
                  <span class="text-xs text-[var(--muted-foreground)]">{new Date(inspection.timestamp).toLocaleTimeString('id-ID')}</span>
                </div>
                <div class="text-xs text-[var(--muted-foreground)]">
                  {inspection.stationId} - {inspection.detections[0]?.label ?? 'Objek'} - {inspection.confidenceScore}%
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
