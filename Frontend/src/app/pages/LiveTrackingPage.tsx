import { useMemo, useState } from 'react';
import { Video, CheckCircle, XCircle, AlertTriangle, Wifi, WifiOff, Play, StopCircle } from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useStations } from '../hooks/useStations';
import { useAgents } from '../hooks/useAgents';
import { useFrameStream } from '../hooks/useFrameStream';
import { api, getErrorMessage } from '../services/api';
import type { AgentInfo, InspectionResult, StationStatusEvent } from '../types/api';

interface MergedStation {
  stationId: string;
  online: boolean;
  running: boolean;
  fps?: number;
  modelVersion?: string;
  state: StationStatusEvent['state'];
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
      state: station.state,
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
      state: agent.online ? 'online' : 'offline',
    });
  }
  return [...map.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));
}

export function LiveTrackingPage() {
  const inspections = useInspections(20);
  const stations = useStations();
  const agents = useAgents();
  const frames = useFrameStream();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  const latestInspections = inspections.data.slice(0, 10);
  const loading = inspections.loading || stations.loading || agents.loading;
  const error = inspections.error || stations.error || agents.error;

  const merged = useMemo(() => mergeStations(agents.data, stations.data), [agents.data, stations.data]);

  const stats = useMemo(() => {
    const okCount = latestInspections.filter((r: InspectionResult) => r.status === 'OK').length;
    const ngCount = latestInspections.filter((r: InspectionResult) => r.status === 'NG').length;
    const total = okCount + ngCount;
    return {
      total,
      ok: okCount,
      ng: ngCount,
      ngRate: total > 0 ? ((ngCount / total) * 100).toFixed(1) : '0.0',
    };
  }, [latestInspections]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleCommand = async (stationId: string, command: 'start' | 'stop') => {
    setBusy((current) => ({ ...current, [stationId]: true }));
    try {
      if (command === 'start') await api.startAgent(stationId);
      else await api.stopAgent(stationId);
      showToast(`Command "${command}" terkirim ke ${stationId}`);
      await agents.refresh();
    } catch (err) {
      showToast(getErrorMessage(err));
    } finally {
      setBusy((current) => ({ ...current, [stationId]: false }));
    }
  };

  const onlineCount = merged.filter((s) => s.online).length;
  const runningCount = merged.filter((s) => s.running).length;

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-blue-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1>Live Tracking</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">
            Stream video & event inspeksi langsung dari agent local
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700">
            <Wifi className="w-3 h-3" /> {onlineCount} Online
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700">
            <Play className="w-3 h-3" /> {runningCount} Running
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { inspections.reload(); stations.reload(); agents.reload(); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {loading && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
          Memuat data live tracking dari backend...
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-3">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm">Kamera Inspeksi</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{merged.length} station terdaftar</span>
            </div>

            {merged.length === 0 ? (
              <div className="text-center py-12 text-[var(--muted-foreground)]">
                <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Belum ada agent yang terhubung.</p>
                <p className="text-xs mt-1">Jalankan agent di mesin local untuk mulai streaming.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {merged.map((s) => {
                  const frameUrl = frames[s.stationId];
                  const isBusy = busy[s.stationId];
                  return (
                    <div key={s.stationId} className="border border-[var(--border)] rounded-lg overflow-hidden flex flex-col">
                      <div className="aspect-video bg-black flex items-center justify-center relative">
                        {s.running && frameUrl ? (
                          <img src={frameUrl} alt={s.stationId} className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-gray-500 text-xs flex flex-col items-center">
                            <Video className="w-8 h-8 mb-2 opacity-50" />
                            {s.online ? (s.running ? 'Menunggu frame...' : 'Idle — klik Mulai untuk streaming') : 'Agent offline'}
                          </div>
                        )}
                        <div className="absolute top-2 left-2 flex gap-1 text-[10px]">
                          <span className={`px-2 py-0.5 rounded-full ${s.online ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                            {s.online ? 'ONLINE' : 'OFFLINE'}
                          </span>
                          {s.running && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-500 text-white">LIVE</span>
                          )}
                        </div>
                        {s.fps && s.running ? (
                          <div className="absolute top-2 right-2 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">
                            {s.fps.toFixed(1)} FPS
                          </div>
                        ) : null}
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm truncate" style={{ fontWeight: 500 }}>{s.stationId}</div>
                          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                            {s.modelVersion ?? 'unknown'}
                          </div>
                        </div>
                        {s.running ? (
                          <button
                            disabled={!s.online || isBusy}
                            onClick={() => handleCommand(s.stationId, 'stop')}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700 disabled:opacity-50"
                          >
                            <StopCircle className="w-3.5 h-3.5" /> Hentikan
                          </button>
                        ) : (
                          <button
                            disabled={!s.online || isBusy}
                            onClick={() => handleCommand(s.stationId, 'start')}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Play className="w-3.5 h-3.5" /> Mulai Inspeksi
                          </button>
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
              <span className="text-xs text-[var(--muted-foreground)]">{latestInspections.length} event terakhir</span>
            </div>
            <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
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
                      Batch: {r.batchNo} | Confidence: {r.confidenceScore}% | Line: {r.line}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Live Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xl text-blue-700" style={{ fontWeight: 500 }}>{stats.total}</div>
                <div className="text-[11px] text-blue-600">Total</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xl text-green-700" style={{ fontWeight: 500 }}>{stats.ok}</div>
                <div className="text-[11px] text-green-600">OK</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xl text-red-700" style={{ fontWeight: 500 }}>{stats.ng}</div>
                <div className="text-[11px] text-red-600">NG</div>
              </div>
              <div className={`rounded-lg p-3 text-center ${parseFloat(stats.ngRate) > 5 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div className={`text-xl ${parseFloat(stats.ngRate) > 5 ? 'text-red-700' : 'text-green-700'}`} style={{ fontWeight: 500 }}>{stats.ngRate}%</div>
                <div className={`text-[11px] ${parseFloat(stats.ngRate) > 5 ? 'text-red-600' : 'text-green-600'}`}>NG Rate</div>
              </div>
            </div>
          </div>

          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Keterangan</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-green-600" />
                <span>Agent online & terhubung WebSocket</span>
              </div>
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-red-600" />
                <span>Agent offline / koneksi terputus</span>
              </div>
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-600" />
                <span>Sedang streaming (kamera capture aktif)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Inspeksi OK (semua dimensi dalam toleransi)</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span>Inspeksi NG (out of tolerance)</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <span>Station degraded (performa menurun)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}