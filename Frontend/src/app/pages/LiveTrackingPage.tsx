import { useEffect, useMemo, useState } from 'react';
import {
  Video, CheckCircle, XCircle, Play, StopCircle, Camera, RefreshCcw, Hand, Zap,
} from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useStations } from '../hooks/useStations';
import { useAgents } from '../hooks/useAgents';
import { useFrameStream } from '../hooks/useFrameStream';
import { useParts } from '../hooks/useParts';
import { useShiftSchedules } from '../hooks/useShiftSchedules';
import { useBatches } from '../hooks/useBatches';
import { api, getErrorMessage } from '../services/api';
import type {
  AgentInfo, InspectionResult, ObjectDetection, StationPhase, StationStatusEvent,
} from '../types/api';

interface MergedStation {
  stationId: string;
  online: boolean;
  running: boolean;
  fps?: number;
  phase?: StationPhase;
  activePartCode?: string;
}

type ViewMode = 'multi' | 'focus' | 'wall';

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
      phase: agent.online ? existing?.phase : 'idle',
      activePartCode: existing?.activePartCode,
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
  const inspections = useInspections(20);
  const stations = useStations();
  const agents = useAgents();
  const parts = useParts();
  const shifts = useShiftSchedules();
  const batches = useBatches();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [selectedPart, setSelectedPart] = useState<Record<string, string>>({});
  const [selectedShift, setSelectedShift] = useState<Record<string, 'A' | 'B' | 'C'>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('multi');
  const [focusStation, setFocusStation] = useState<string | null>(null);
  const [selectedDetection, setSelectedDetection] = useState<ObjectDetection | null>(null);

  const latestInspections = inspections.data.slice(0, 10);
  const loading = inspections.loading || stations.loading || agents.loading || parts.loading || shifts.loading || batches.loading;
  const error = inspections.error || stations.error || agents.error || parts.error || shifts.error || batches.error;

  const merged = useMemo(() => mergeStations(agents.data, stations.data), [agents.data, stations.data]);
  const visibleStations = useMemo(() => {
    if (viewMode === 'focus' && focusStation) return merged.filter((station) => station.stationId === focusStation);
    return merged;
  }, [focusStation, merged, viewMode]);
  const frames = useFrameStream(visibleStations.map((station) => station.stationId));
  const latestByStation = useMemo(() => {
    const map = new Map<string, InspectionResult>();
    for (const inspection of inspections.data) {
      if (!map.has(inspection.stationId)) map.set(inspection.stationId, inspection);
    }
    return map;
  }, [inspections.data]);

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
          {(['multi', 'focus', 'wall'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded-full ${viewMode === mode ? 'bg-blue-600 text-white' : 'bg-[var(--accent)] text-[var(--foreground)]'}`}
            >
              {mode === 'multi' ? 'Multi' : mode === 'focus' ? 'Focus' : 'Wall'}
            </button>
          ))}
          <span className="px-2 py-1 rounded-full bg-green-100 text-green-700">
            {onlineCount} Online
          </span>
          <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">
            {runningCount} Running
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={() => { inspections.reload(); stations.reload(); agents.reload(); parts.reload(); }}
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs"
          >
            Coba lagi
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm">Kamera</h3>
            <span className="text-xs text-[var(--muted-foreground)]">{merged.length} station</span>
          </div>

          {loading && merged.length === 0 ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-72 bg-[var(--accent)] rounded animate-pulse" />
              ))}
            </div>
          ) : merged.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted-foreground)]">
              <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Belum ada agent yang terhubung.</p>
              <p className="text-xs mt-1">Jalankan agent di mesin local untuk mulai streaming.</p>
            </div>
          ) : (
            <div className={viewMode === 'wall' ? 'grid md:grid-cols-3 gap-3' : viewMode === 'focus' ? 'grid gap-4' : 'grid xl:grid-cols-2 gap-4'}>
              {visibleStations.map((s) => {
                const frameUrl = frames[s.stationId];
                const isBusy = busy[s.stationId];
                const phase = s.phase ?? (s.running ? 'ready' : 'idle');
                const PhaseMeta = PHASE_LABELS[phase];
                const PhaseIcon = PhaseMeta.icon;
                const partCode = selectedPart[s.stationId] ?? '';
                const activePart = parts.data.find((p) => p.partCode === s.activePartCode);
                const shift = selectedShift[s.stationId] ?? 'A';
                const latest = latestByStation.get(s.stationId);
                const detections = latest?.detections ?? [];
                const openBatch = batches.data.find((batch) => batch.status === 'open' && batch.partCode === partCode && batch.shift === shift);

                return (
                  <div key={s.stationId} className="border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
                    <button onClick={() => { setFocusStation(s.stationId); setViewMode('focus'); }} className={`aspect-video bg-black flex items-center justify-center relative ${viewMode === 'focus' ? 'min-h-[480px]' : ''}`}>
                      {s.running && frameUrl ? (
                        <img src={frameUrl} alt={s.stationId} className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-gray-500 text-xs flex flex-col items-center">
                          <Video className="w-8 h-8 mb-2 opacity-50" />
                          {s.online ? (s.running ? 'Menunggu frame...' : 'Idle — pilih part lalu klik Mulai') : 'Agent offline'}
                        </div>
                      )}
                      {detections.map((detection) => (
                        <button
                          key={detection.id}
                          onClick={(event) => { event.stopPropagation(); setSelectedDetection(detection); }}
                          className={`absolute border-2 ${detection.status === 'OK' ? 'border-green-400' : 'border-red-400'} bg-transparent`}
                          style={{
                            left: `${detection.bbox.x}%`,
                            top: `${detection.bbox.y}%`,
                            width: `${detection.bbox.width}%`,
                            height: `${detection.bbox.height}%`,
                          }}
                          title={detection.label}
                        />
                      ))}
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
                      {s.fps && s.running ? (
                        <div className="absolute top-2 right-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">
                          {s.fps.toFixed(1)} FPS
                        </div>
                      ) : null}
                    </button>

                    <div className="p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate" style={{ fontWeight: 500 }}>{s.stationId}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                            {activePart ? `${activePart.partName} • ${activePart.partCode}` : 'Belum ada part'}
                          </div>
                        </div>
                      </div>

                      {!s.running ? (
                        <div className="grid md:grid-cols-[1fr_90px_120px] gap-2">
                          <select
                            disabled={!s.online || isBusy || parts.data.length === 0}
                            value={partCode}
                            onChange={(e) => setSelectedPart((c) => ({ ...c, [s.stationId]: e.target.value }))}
                            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            {parts.data.length === 0 && <option value="">Tidak ada part</option>}
                            {parts.data.map((p) => (
                              <option key={p.partCode} value={p.partCode}>{p.partName} ({p.partCode})</option>
                            ))}
                          </select>
                          <select
                            disabled={!s.online || isBusy}
                            value={shift}
                            onChange={(e) => setSelectedShift((c) => ({ ...c, [s.stationId]: e.target.value as 'A' | 'B' | 'C' }))}
                            className="px-2.5 py-1.5 text-xs border border-[var(--border)] rounded-lg bg-[var(--card)] disabled:opacity-50"
                          >
                            {shifts.data.filter((item) => item.active).map((item) => (
                              <option key={item.id} value={item.shift}>{item.shift}</option>
                            ))}
                          </select>
                          <button
                            disabled={!s.online || isBusy || !partCode}
                            onClick={() => runCommand(s.stationId, 'Mulai', () => api.startAgent(s.stationId, partCode, shift, openBatch?.batchNo))}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 shrink-0"
                          >
                            <Play className="w-3.5 h-3.5" /> Mulai
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            disabled={!s.online || isBusy || phase === 'calibrating'}
                            onClick={() => runCommand(s.stationId, 'Capture', () => api.captureNow(s.stationId))}
                            title="Simpan inspeksi sekarang"
                            className="flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Camera className="w-3.5 h-3.5" /> Capture
                          </button>
                          <button
                            disabled={!s.online || isBusy}
                            onClick={() => runCommand(s.stationId, 'Recalibrate', () => api.recalibrate(s.stationId))}
                            title="Ulangi kalibrasi background (kamera harus kosong)"
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
          {selectedDetection && (
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm">{selectedDetection.label}</h4>
                <span className={`text-xs ${selectedDetection.status === 'OK' ? 'text-green-600' : 'text-red-600'}`}>{selectedDetection.status}</span>
              </div>
              <div className="space-y-1">
                {selectedDetection.measurements.map((measurement) => (
                  <div key={measurement.dimensionName} className="flex justify-between text-xs">
                    <span>{measurement.dimensionName}</span>
                    <span>{measurement.measured} {measurement.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
            {latestInspections.length === 0 ? (
              <div className="text-center py-8 text-[var(--muted-foreground)] text-sm">
                Belum ada event inspeksi.
              </div>
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
                    {r.stationId} • {r.detections.length || 1} objek • {r.confidenceScore}%
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
