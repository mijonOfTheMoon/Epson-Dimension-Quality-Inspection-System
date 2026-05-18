import { useMemo } from 'react';
import { Video, Activity, CheckCircle, XCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useStations } from '../hooks/useStations';
import type { InspectionResult } from '../types/api';

export function LiveTrackingPage() {
  const inspections = useInspections(20);
  const stations = useStations();
  const latestInspections = inspections.data.slice(0, 10);
  const loading = inspections.loading || stations.loading;
  const error = inspections.error || stations.error;

  const stats = useMemo(() => {
    const okCount = latestInspections.filter((r) => r.status === 'OK').length;
    const ngCount = latestInspections.filter((r) => r.status === 'NG').length;
    const total = okCount + ngCount;
    return {
      total,
      ok: okCount,
      ng: ngCount,
      ngRate: total > 0 ? ((ngCount / total) * 100).toFixed(1) : '0.0',
    };
  }, [latestInspections]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1>Live Tracking</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">Real-time inspection stream dari backend</p>
        </div>
        <div className="flex items-center gap-2">
          {stations.data.length > 0 && stations.data.every((s) => s.state === 'online') ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">
              <Wifi className="w-3 h-3" /> Semua Station Online
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-700 text-xs">
              <WifiOff className="w-3 h-3" /> Station Offline
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { inspections.reload(); stations.reload(); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {loading && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
          Memuat data live tracking dari backend...
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Latest Inspection Stream */}
        <div className="flex flex-col gap-3">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="text-sm">Stream Inspeksi Terbaru</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{latestInspections.length} event terakhir</span>
            </div>
            <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
              {latestInspections.length === 0 ? (
                <div className="text-center py-12 text-[var(--muted-foreground)]">
                  <Video className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Belum ada data inspeksi dari backend.</p>
                  <p className="text-xs mt-1">Jalankan Agent atau kirim event inspeksi untuk memulai stream.</p>
                </div>
              ) : (
                latestInspections.map((r) => (
                  <div key={r.id} className={`p-3 rounded-lg border ${r.status === 'OK' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {r.status === 'OK' ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                        <span className="text-sm" style={{ fontWeight: 500 }}>{r.partName} ({r.partCode})</span>
                      </div>
                      <span className="text-xs text-[var(--muted-foreground)]">{new Date(r.timestamp).toLocaleTimeString('id-ID')}</span>
                    </div>
                    <div className="text-xs text-[var(--muted-foreground)] mb-2">
                      Batch: {r.batchNo} | Operator: {r.operatorName} | Confidence: {r.confidenceScore}%
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {r.measurements.slice(0, 4).map((m) => (
                        <div key={m.dimensionName} className={`p-2 rounded text-xs ${m.status === 'OK' ? 'bg-white border border-green-200' : 'bg-white border border-red-200'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--muted-foreground)]">{m.dimensionName}</span>
                            <span className={m.status === 'OK' ? 'text-green-700' : 'text-red-700'} style={{ fontWeight: 500 }}>{m.measured} {m.unit}</span>
                          </div>
                          <div className="text-[10px] text-[var(--muted-foreground)]">
                            Nom: {m.nominal} ({m.lowerLimit} - {m.upperLimit})
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="flex flex-col gap-3">
          {/* Live Stats */}
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

          {/* Station Status */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Status Station</h3>
            <div className="space-y-2">
              {stations.data.length === 0 ? (
                <div className="text-center py-4 text-[var(--muted-foreground)] text-xs">
                  Belum ada data station dari backend.
                </div>
              ) : (
                stations.data.map((s) => (
                  <div key={s.stationId} className={`flex items-center justify-between p-2 rounded-lg text-xs ${s.state === 'online' ? 'bg-green-50' : s.state === 'offline' ? 'bg-red-50' : 'bg-yellow-50'}`}>
                    <div className="flex items-center gap-2">
                      {s.state === 'online' ? <Wifi className="w-3 h-3 text-green-600" /> : <WifiOff className="w-3 h-3 text-red-600" />}
                      <span style={{ fontWeight: 500 }}>{s.stationId}</span>
                    </div>
                    <span className="text-[var(--muted-foreground)]">
                      {s.fps ? `${s.fps} FPS` : ''} {s.modelVersion ? `| ${s.modelVersion}` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <h3 className="mb-3">Keterangan</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Inspeksi OK (semua dimensi dalam toleransi)</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span>Inspeksi NG (ada dimensi out of tolerance)</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                <span>Station Degraded (performansi menurun)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}