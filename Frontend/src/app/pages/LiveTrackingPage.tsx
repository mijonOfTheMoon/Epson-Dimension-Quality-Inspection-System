import { useEffect, useMemo, useState } from 'react';
import {
  Camera, CheckCircle, Hand, Maximize2, Minimize2, MoreVertical, Play, RefreshCcw,
  RotateCcw, StopCircle, Trash2, Video, XCircle, Zap,
} from 'lucide-react';
import { useAgents } from '../hooks/useAgents';
import { useBatches } from '../hooks/useBatches';
import { useFrameStream } from '../hooks/useFrameStream';
import { useInspections } from '../hooks/useInspections';
import { useParts } from '../hooks/useParts';
import { useShiftSchedules } from '../hooks/useShiftSchedules';
import { useStations } from '../hooks/useStations';
import { api, getErrorMessage } from '../services/api';
import type {
  AgentInfo, DimensionView, InspectionResult, ObjectDetection, StationPhase, StationStatusEvent,
} from '../types/api';

interface MergedStation {
  stationId: string;
  online: boolean;
  running: boolean;
  fps?: number;
  phase?: StationPhase;
  activePartCode?: string;
}

interface SelectedDetectionKey {
  stationId: string;
  detectionId: string;
}

interface StationInspectionGroup {
  latest: InspectionResult;
  detections: ObjectDetection[];
}

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
    if (!existing) continue;
    map.set(agent.stationId, {
      stationId: agent.stationId,
      online: agent.online,
      running: agent.running,
      fps: existing.fps,
      phase: agent.online ? existing.phase : 'idle',
      activePartCode: existing.activePartCode,
    });
  }
  return [...map.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
}

const PHASE_LABELS: Record<StationPhase, { text: string; tone: string; icon: typeof Camera }> = {
  idle: { text: 'Idle', tone: 'bg-gray-100 text-gray-700', icon: StopCircle },
  calibrating: { text: 'Kalibrasi', tone: 'bg-amber-100 text-amber-700', icon: RefreshCcw },
  ready: { text: 'Siap', tone: 'bg-blue-100 text-blue-700', icon: Hand },
  stabilizing: { text: 'Deteksi', tone: 'bg-purple-100 text-purple-700', icon: Zap },
  locked: { text: 'Terkunci', tone: 'bg-green-100 text-green-700', icon: CheckCircle },
};

export function LiveTrackingPage() {
  const inspections = useInspections(40);
  const stations = useStations();
  const agents = useAgents();
  const parts = useParts();
  const shifts = useShiftSchedules();
  const batches = useBatches();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [selectedPart, setSelectedPart] = useState<Record<string, string>>({});
  const [selectedShift, setSelectedShift] = useState<Record<string, 'A' | 'B' | 'C'>>({});
  const [inspectionView, setInspectionView] = useState<Record<string, DimensionView>>({});
  const [focusedStationId, setFocusedStationId] = useState<string | null>(null);
  const [menuStationId, setMenuStationId] = useState<string | null>(null);
  const [selectedDetectionKey, setSelectedDetectionKey] = useState<SelectedDetectionKey | null>(null);
  const [boxesHidden, setBoxesHidden] = useState(false);

  const latestInspections = inspections.data.slice(0, 10);
  const loading = inspections.loading || stations.loading || agents.loading || parts.loading || shifts.loading || batches.loading;
  const error = inspections.error || stations.error || agents.error || parts.error || shifts.error || batches.error;

  const merged = useMemo(() => mergeStations(agents.data, stations.data), [agents.data, stations.data]);
  const visibleStations = useMemo(
    () => focusedStationId ? merged.filter((station) => station.stationId === focusedStationId) : merged,
    [focusedStationId, merged],
  );
  const frames = useFrameStream(visibleStations.map((station) => station.stationId));

  const latestGroupsByStation = useMemo(() => {
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
  }, [inspections.data]);

  const selectedDetection = useMemo(() => {
    if (!selectedDetectionKey) return null;
    const group = latestGroupsByStation.get(selectedDetectionKey.stationId);
    return group?.detections.find((item) => item.id === selectedDetectionKey.detectionId) ?? null;
  }, [latestGroupsByStation, selectedDetectionKey]);

  useEffect(() => {
    const latest = inspections.data[0];
    setBoxesHidden(false);
    if (latest?.detections[0]) {
      setSelectedDetectionKey({ stationId: latest.stationId, detectionId: latest.detections[0].id });
    } else {
      setSelectedDetectionKey(null);
    }
  }, [inspections.data[0]?.id]);

  useEffect(() => {
    if (parts.data.length === 0) return;
    setSelectedPart((current) => {
      const next = { ...current };
      let changed = false;
      for (const s of merged) {
        if (!next[s.stationId]) {
          next[s.stationId] = s.activePartCode ?? parts.data[0].partCode;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [merged, parts.data]);

  useEffect(() => {
    const activeShift = shifts.data.find((shift) => shift.active)?.shift ?? 'A';
    setSelectedShift((current) => {
      const next = { ...current };
      let changed = false;
      for (const s of merged) {
        if (!next[s.stationId]) {
          next[s.stationId] = activeShift;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [merged, shifts.data]);

  useEffect(() => {
    setInspectionView((current) => {
      const next = { ...current };
      let changed = false;
      for (const station of merged) {
        const partCode = selectedPart[station.stationId];
        const part = parts.data.find((item) => item.partCode === partCode);
        const hasSide = part?.dimensions.some((dimension) => dimension.view === 'side') ?? false;
        if (!next[station.stationId] || (!hasSide && next[station.stationId] !== 'top')) {
          next[station.stationId] = 'top';
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [merged, parts.data, selectedPart]);

  const showToast = (text: string, tone: 'info' | 'error' = 'info') => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 2800);
  };

  const runCommand = async (stationId: string, label: string, fn: () => Promise<unknown>) => {
    setBusy((current) => ({ ...current, [stationId]: true }));
    try {
      await fn();
      showToast(`${label}: ${stationId}`);
      await agents.refresh();
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy((current) => ({ ...current, [stationId]: false }));
    }
  };

  const removeStation = async (stationId: string) => {
    setBusy((current) => ({ ...current, [stationId]: true }));
    try {
      await api.deleteStation(stationId);
      if (focusedStationId === stationId) setFocusedStationId(null);
      if (selectedDetectionKey?.stationId === stationId) setSelectedDetectionKey(null);
      setMenuStationId(null);
      stations.reload();
      await agents.refresh();
      showToast(`Cam dihapus dari tampilan: ${stationId}`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy((current) => ({ ...current, [stationId]: false }));
    }
  };

  const onlineCount = merged.filter((s) => s.online).length;
  const runningCount = merged.filter((s) => s.running).length;
  const shiftStats = latestInspections.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'OK') acc.ok += 1;
    if (item.status === 'NG') acc.ng += 1;
    return acc;
  }, { total: 0, ok: 0, ng: 0 });
  const shiftNgRate = shiftStats.total > 0 ? ((shiftStats.ng / shiftStats.total) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm text-white ${toast.tone === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}>
          {toast.text}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1>Live Tracking</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">
            Streaming berjalan terus. Data masuk saat operator menekan Capture.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-green-100 text-green-700">{onlineCount} Online</span>
          <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">{runningCount} Running</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={() => { inspections.reload(); stations.reload(); agents.reload(); parts.reload(); batches.reload(); }}
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs"
          >
            Coba lagi
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm">Kamera</h3>
            <span className="text-xs text-[var(--muted-foreground)]">
              {focusedStationId ? `Focus: ${focusedStationId}` : `${merged.length} station`}
            </span>
          </div>

          {loading && merged.length === 0 ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => <div key={i} className="h-72 bg-[var(--accent)] rounded animate-pulse" />)}
            </div>
          ) : merged.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Belum ada agent yang terhubung.</p>
              <p className="text-xs mt-1">Jalankan agent di mesin local untuk mulai streaming.</p>
            </div>
          ) : (
            <div className={focusedStationId ? 'grid gap-4' : 'grid xl:grid-cols-2 gap-4'}>
              {visibleStations.map((s) => {
                const frameUrl = frames[s.stationId];
                const isBusy = busy[s.stationId];
                const phase = s.phase ?? (s.running ? 'ready' : 'idle');
                const PhaseMeta = PHASE_LABELS[phase];
                const PhaseIcon = PhaseMeta.icon;
                const partCode = selectedPart[s.stationId] ?? '';
                const selectedPartType = parts.data.find((p) => p.partCode === partCode);
                const activePart = parts.data.find((p) => p.partCode === s.activePartCode) ?? selectedPartType;
                const hasSideView = selectedPartType?.dimensions.some((dimension) => dimension.view === 'side') ?? false;
                const view = inspectionView[s.stationId] ?? 'top';
                const shift = selectedShift[s.stationId] ?? 'A';
                const latestGroup = latestGroupsByStation.get(s.stationId);
                const detections = boxesHidden ? [] : latestGroup?.detections ?? [];
                const openBatch = batches.data.find((batch) => batch.status === 'open' && batch.partCode === partCode && batch.shift === shift);

                return (
                  <div key={s.stationId} className="border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
                    <div className={`aspect-video bg-black flex items-center justify-center relative ${focusedStationId ? 'min-h-[480px]' : ''}`}>
                      {s.running && frameUrl ? (
                        <img src={frameUrl} alt={s.stationId} className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-gray-500 text-xs flex flex-col items-center">
                          <Video className="w-8 h-8 mb-2 opacity-50" />
                          {s.online ? (s.running ? 'Menunggu frame...' : 'Idle - pilih part lalu klik Mulai') : 'Agent offline'}
                        </div>
                      )}

                      {detections.map((detection) => {
                        const selected = selectedDetectionKey?.stationId === s.stationId && selectedDetectionKey.detectionId === detection.id;
                        return (
                          <button
                            key={detection.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedDetectionKey({ stationId: s.stationId, detectionId: detection.id });
                            }}
                            className={`absolute bg-transparent ${selected ? 'border-4 ring-2 ring-white z-20' : 'border-2 z-10'} ${detection.status === 'OK' ? 'border-green-400' : 'border-red-400'}`}
                            style={{
                              left: `${detection.bbox.x}%`,
                              top: `${detection.bbox.y}%`,
                              width: `${detection.bbox.width}%`,
                              height: `${detection.bbox.height}%`,
                            }}
                            title={detection.label}
                          />
                        );
                      })}

                      <div className="absolute top-2 left-2 flex flex-col gap-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.online ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                          {s.online ? 'ONLINE' : 'OFFLINE'}
                        </span>
                        {s.running && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${PhaseMeta.tone}`}>
                            <PhaseIcon className="w-3 h-3" />
                            {PhaseMeta.text}
                          </span>
                        )}
                      </div>

                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {s.fps && s.running ? (
                          <span className="text-[10px] bg-black/60 text-white px-2 py-1 rounded-full">{s.fps.toFixed(1)} FPS</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setFocusedStationId(focusedStationId === s.stationId ? null : s.stationId)}
                          title={focusedStationId === s.stationId ? 'Minimize' : 'Maximize'}
                          className="w-8 h-8 rounded-full bg-black/60 text-white inline-flex items-center justify-center hover:bg-black/80"
                        >
                          {focusedStationId === s.stationId ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setMenuStationId((current) => current === s.stationId ? null : s.stationId)}
                            title="Menu camera"
                            className="w-8 h-8 rounded-full bg-black/60 text-white inline-flex items-center justify-center hover:bg-black/80"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {menuStationId === s.stationId && (
                            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg z-30 p-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void removeStation(s.stationId)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 className="w-4 h-4" /> Hapus dari tampilan
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate" style={{ fontWeight: 500 }}>{s.stationId}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                            {activePart ? `${activePart.partName} - ${activePart.partCode}` : 'Belum ada part'}
                          </div>
                        </div>
                      </div>

                      {!s.running ? (
                        <div className="grid md:grid-cols-[1fr_92px_120px_120px] gap-2">
                          <select
                            disabled={!s.online || isBusy || parts.data.length === 0}
                            value={partCode}
                            onChange={(e) => setSelectedPart((current) => ({ ...current, [s.stationId]: e.target.value }))}
                            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            {parts.data.length === 0 && <option value="">Tidak ada part</option>}
                            {parts.data.map((p) => <option key={p.partCode} value={p.partCode}>{p.partName} ({p.partCode})</option>)}
                          </select>
                          <select
                            disabled={!s.online || isBusy}
                            value={shift}
                            onChange={(e) => setSelectedShift((current) => ({ ...current, [s.stationId]: e.target.value as 'A' | 'B' | 'C' }))}
                            className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            {shifts.data.filter((item) => item.active).map((item) => <option key={item.id} value={item.shift}>{item.shift}</option>)}
                          </select>
                          <select
                            disabled={!s.online || isBusy || !hasSideView}
                            value={view}
                            onChange={(e) => setInspectionView((current) => ({ ...current, [s.stationId]: e.target.value as DimensionView }))}
                            className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            <option value="top">Tampak Atas</option>
                            <option value="side">Tampak Samping</option>
                          </select>
                          <button
                            disabled={!s.online || isBusy || !partCode}
                            onClick={() => runCommand(s.stationId, 'Mulai', () => api.startAgent(s.stationId, partCode, shift, openBatch?.batchNo, view))}
                            className="flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 shrink-0"
                          >
                            <Play className="w-3.5 h-3.5" /> Mulai
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-1.5">
                          <select
                            disabled={!s.online || isBusy || !hasSideView}
                            value={view}
                            onChange={(e) => setInspectionView((current) => ({ ...current, [s.stationId]: e.target.value as DimensionView }))}
                            className="px-2 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            <option value="top">Atas</option>
                            <option value="side">Samping</option>
                          </select>
                          <button
                            disabled={!s.online || isBusy || phase === 'calibrating'}
                            onClick={() => runCommand(s.stationId, 'Capture', () => api.captureNow(s.stationId, view))}
                            title="Simpan inspeksi sekarang"
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Camera className="w-3.5 h-3.5" /> Capture
                          </button>
                          <button
                            disabled={!s.online || isBusy}
                            onClick={() => runCommand(s.stationId, 'Kalibrasi', () => api.recalibrate(s.stationId))}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500 text-white rounded-lg text-xs hover:bg-amber-600 disabled:opacity-50"
                          >
                            <RefreshCcw className="w-3.5 h-3.5" /> Kalibrasi
                          </button>
                          <button
                            disabled={!s.online || isBusy}
                            onClick={() => runCommand(s.stationId, 'Berhenti', () => api.stopAgent(s.stationId))}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700 disabled:opacity-50"
                          >
                            <StopCircle className="w-3.5 h-3.5" /> Stop
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <DimensionStats detection={selectedDetection} onReset={() => { setSelectedDetectionKey(null); setBoxesHidden(true); }} />

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="text-sm">Shift ini</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{latestInspections.length} data</span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4 border-b border-[var(--border)] text-center text-sm">
              <div><div className="text-xl font-medium">{shiftStats.total}</div><div className="text-xs text-[var(--muted-foreground)]">Total</div></div>
              <div><div className="text-xl font-medium text-green-600">{shiftStats.ok}</div><div className="text-xs text-[var(--muted-foreground)]">OK</div></div>
              <div><div className="text-xl font-medium text-red-600">{shiftNgRate}%</div><div className="text-xs text-[var(--muted-foreground)]">NG</div></div>
            </div>
            <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
              {latestInspections.length === 0 ? (
                <div className="text-center py-8 text-[var(--muted-foreground)] text-sm">Belum ada event inspeksi.</div>
              ) : (
                latestInspections.map((r: InspectionResult) => (
                  <div key={r.id} className={`p-3 rounded-lg border ${r.status === 'OK' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {r.status === 'OK' ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                        <span className="text-sm" style={{ fontWeight: 500 }}>{r.partName} ({r.partCode})</span>
                      </div>
                      <span className="text-xs text-[var(--muted-foreground)]">{new Date(r.timestamp).toLocaleTimeString('id-ID')}</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)]">
                      {r.stationId} - {r.detections[0]?.label ?? 'Objek'} - {r.confidenceScore}%
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionStats({ detection, onReset }: { detection: ObjectDetection | null; onReset: () => void }) {
  const measurements = detection?.measurements ?? [];
  const okCount = measurements.filter((item) => item.status === 'OK').length;
  const ngCount = measurements.filter((item) => item.status === 'NG' || item.status === 'UNREADABLE').length;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm">Stats Dimensi</h3>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {detection ? detection.label : 'Pilih bounding box untuk melihat detail'}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs hover:bg-[var(--accent)]"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-[var(--accent)] p-3">
            <div className="text-[11px] text-[var(--muted-foreground)]">Status</div>
            <div className={`text-lg font-medium ${detection?.status === 'NG' ? 'text-red-600' : detection ? 'text-green-600' : 'text-[var(--muted-foreground)]'}`}>
              {detection?.status ?? '-'}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--accent)] p-3">
            <div className="text-[11px] text-[var(--muted-foreground)]">Confidence</div>
            <div className="text-lg font-medium">{detection ? `${detection.confidenceScore}%` : '-'}</div>
          </div>
          <div className="rounded-lg bg-[var(--accent)] p-3">
            <div className="text-[11px] text-[var(--muted-foreground)]">OK / NG</div>
            <div className="text-lg font-medium"><span className="text-green-600">{okCount}</span> / <span className="text-red-600">{ngCount}</span></div>
          </div>
        </div>

        {measurements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
            Belum ada dimensi yang dipilih.
          </div>
        ) : (
          <div className="space-y-2">
            {measurements.map((measurement) => {
              const delta = measurement.measured - measurement.nominal;
              const statusLabel = measurement.status === 'UNREADABLE' ? 'Tidak terbaca' : measurement.status;
              return (
                <div key={measurement.dimensionName} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{measurement.dimensionName}</div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        Toleransi {measurement.lowerLimit} - {measurement.upperLimit} {measurement.unit}
                      </div>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${measurement.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div><div className="text-[var(--muted-foreground)]">Measured</div><div className="font-medium">{measurement.measured} {measurement.unit}</div></div>
                    <div><div className="text-[var(--muted-foreground)]">Nominal</div><div className="font-medium">{measurement.nominal} {measurement.unit}</div></div>
                    <div><div className="text-[var(--muted-foreground)]">Delta</div><div className={Math.abs(delta) > 0 ? 'font-medium text-amber-700' : 'font-medium'}>{delta.toFixed(3)} {measurement.unit}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
