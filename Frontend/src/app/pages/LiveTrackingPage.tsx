import { useEffect, useMemo, useState } from 'react';
import {
  Video, CheckCircle, XCircle, Play, StopCircle, Camera, RefreshCcw, Hand, Zap,
} from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useStations } from '../hooks/useStations';
import { useAgents } from '../hooks/useAgents';
import { useFrameStream } from '../hooks/useFrameStream';
import { useParts } from '../hooks/useParts';
import { api, getErrorMessage } from '../services/api';
import type {
  AgentInfo, InspectionResult, StationPhase, StationStatusEvent,
} from '../types/api';

interface MergedStation {
  stationId: string;
  online: boolean;
  running: boolean;
  fps?: number;
  modelVersion?: string;
  phase?: StationPhase;
  activePartCode?: string;
}

function mergeStations(agents: AgentInfo[], stations: StationStatusEvent[]): MergedStation[] {
  const map = new Map<string, MergedStation>();
  for (const station of stations) {
    map.set(station.stationId, {
      stationId: station.stationId,
      online: station.state === 'online',
      running: Boolean(station.running),
      fps: station.fps,
      modelVersion: station.modelVersion,
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
      modelVersion: existing?.modelVersion,
      phase: agent.online ? existing?.phase : 'idle',
      activePartCode: existing?.activePartCode,
    });
  }
  return [...map.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
}

const PHASE_LABELS: Record<StationPhase, { text: string; tone: string; icon: typeof Camera }> = {
  idle: { text: 'Idle', tone: 'bg-gray-100 text-gray-700', icon: StopCircle },
  calibrating: { text: 'Kalibrasi background', tone: 'bg-amber-100 text-amber-700', icon: RefreshCcw },
  ready: { text: 'Siap — masukkan part', tone: 'bg-blue-100 text-blue-700', icon: Hand },
  stabilizing: { text: 'Mendeteksi part...', tone: 'bg-purple-100 text-purple-700', icon: Zap },
  locked: { text: 'Tercatat — angkat part', tone: 'bg-green-100 text-green-700', icon: CheckCircle },
};

export function LiveTrackingPage() {
  const inspections = useInspections(20);
  const stations = useStations();
  const agents = useAgents();
  const parts = useParts();
  const frames = useFrameStream();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [selectedPart, setSelectedPart] = useState<Record<string, string>>({});

  const latestInspections = inspections.data.slice(0, 10);
  const loading = inspections.loading || stations.loading || agents.loading || parts.loading;
  const error = inspections.error || stations.error || agents.error || parts.error;

  const merged = useMemo(() => mergeStations(agents.data, stations.data), [agents.data, stations.data]);

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
            Pilih part, mulai inspeksi, dan letakkan part di bawah kamera — sistem otomatis mencatat 1 part = 1 data.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
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

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm">Kamera Inspeksi</h3>
            <span className="text-xs text-[var(--muted-foreground)]">{merged.length} station terdaftar</span>
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
            <div className="grid sm:grid-cols-2 gap-4">
              {merged.map((s) => {
                const frameUrl = frames[s.stationId];
                const isBusy = busy[s.stationId];
                const phase = s.phase ?? (s.running ? 'ready' : 'idle');
                const PhaseMeta = PHASE_LABELS[phase];
                const PhaseIcon = PhaseMeta.icon;
                const partCode = selectedPart[s.stationId] ?? '';
                const activePart = parts.data.find((p) => p.partCode === s.activePartCode);

                return (
                  <div key={s.stationId} className="border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
                    <div className="aspect-video bg-black flex items-center justify-center relative">
                      {s.running && frameUrl ? (
                        <img src={frameUrl} alt={s.stationId} className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-gray-500 text-xs flex flex-col items-center">
                          <Video className="w-8 h-8 mb-2 opacity-50" />
                          {s.online ? (s.running ? 'Menunggu frame...' : 'Idle — pilih part lalu klik Mulai') : 'Agent offline'}
                        </div>
                      )}
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
                    </div>

                    <div className="p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate" style={{ fontWeight: 500 }}>{s.stationId}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                            {activePart ? `${activePart.partName} • ${activePart.partCode}` : (s.modelVersion ?? 'belum ada part')}
                          </div>
                        </div>
                      </div>

                      {!s.running ? (
                        <div className="flex items-center gap-2">
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
                          <button
                            disabled={!s.online || isBusy || !partCode}
                            onClick={() => runCommand(s.stationId, 'Mulai inspeksi', () => api.startAgent(s.stationId, partCode))}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 shrink-0"
                          >
                            <Play className="w-3.5 h-3.5" /> Mulai
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            disabled={!s.online || isBusy || phase === 'calibrating'}
                            onClick={() => runCommand(s.stationId, 'Capture manual', () => api.captureNow(s.stationId))}
                            title="Paksa simpan satu inspeksi sekarang"
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
            <h3 className="text-sm">Stream Event Inspeksi</h3>
            <span className="text-xs text-[var(--muted-foreground)]">{latestInspections.length} terakhir</span>
          </div>
          <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
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
                    Confidence: {r.confidenceScore}% • {r.trigger === 'manual' ? 'Manual' : 'Auto'}
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
