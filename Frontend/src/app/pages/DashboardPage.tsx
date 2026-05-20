import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { CheckCircle, XCircle, Activity, TrendingDown } from 'lucide-react';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { useInspections } from '../hooks/useInspections';
import { useParts } from '../hooks/useParts';
import type { InspectionResult } from '../types/api';

export function DashboardPage() {
  const summary = useDashboardSummary();
  const inspections = useInspections(200);
  const parts = useParts();
  const loading = summary.loading;
  const error = summary.error || inspections.error;

  const { ngByPart, recentNG } = useMemo(() => {
    const partMap = new Map<string, { name: string; ok: number; ng: number }>(
      parts.data.map((pt) => [pt.partCode, { name: pt.partName, ok: 0, ng: 0 }]),
    );
    const latestNg: InspectionResult[] = [];

    for (const result of inspections.data) {
      const isNg = result.status === 'NG';
      if (isNg && latestNg.length < 5) latestNg.push(result);

      let part = partMap.get(result.partCode);
      if (!part) { part = { name: result.partName, ok: 0, ng: 0 }; partMap.set(result.partCode, part); }
      if (isNg) part.ng += 1; else part.ok += 1;
    }

    return {
      ngByPart: [...partMap.values()],
      recentNG: latestNg,
    };
  }, [inspections.data, parts.data]);

  const { total, ok, ng, ngRate, dailyTrend } = summary.data;

  const cards = [
    { label: 'Total Inspeksi', value: total, icon: Activity, color: 'blue' },
    { label: 'Part OK', value: ok, icon: CheckCircle, color: 'green' },
    { label: 'Part NG', value: ng, icon: XCircle, color: 'red' },
    { label: 'NG Rate', value: `${ngRate.toFixed(1)}%`, icon: TrendingDown, color: 'orange' },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Dashboard Monitoring</h1>
        <p className="text-[var(--muted-foreground)] text-sm mt-1">Overview kualitas inspeksi dimensi real-time</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { summary.reload(); inspections.reload(); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-xl p-4 text-sm">
          Belum ada data inspeksi. Jalankan Agent untuk mengisi dashboard.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[var(--muted-foreground)]">{c.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[c.color]}`}>
                <c.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl" style={{ fontWeight: 500 }}>
              {loading ? <span className="inline-block w-12 h-7 bg-[var(--accent)] rounded animate-pulse" /> : c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
        <h3 className="mb-4">Tren Inspeksi Harian</h3>
        {loading ? (
          <div className="h-[280px] bg-[var(--accent)] rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="ok" stroke="#22c55e" name="OK" strokeWidth={2} />
              <Line type="monotone" dataKey="ng" stroke="#ef4444" name="NG" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
        <h3 className="mb-4">NG per Tipe Part</h3>
        {loading ? (
          <div className="h-[220px] bg-[var(--accent)] rounded animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ngByPart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="ok" fill="#22c55e" name="OK" stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="ng" fill="#ef4444" name="NG" stackId="a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
        <h3 className="mb-4">Part NG Terbaru</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                <th className="pb-2 pr-4">ID</th>
                <th className="pb-2 pr-4">Part</th>
                <th className="pb-2 pr-4">Batch</th>
                <th className="pb-2 pr-4">Dimensi NG</th>
                <th className="pb-2 pr-4">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {recentNG.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]">
                  <td className="py-2.5 pr-4">{r.id}</td>
                  <td className="py-2.5 pr-4">{r.partName} ({r.partCode})</td>
                  <td className="py-2.5 pr-4">{r.batchNo}</td>
                  <td className="py-2.5 pr-4">
                    {r.measurements.filter((m) => m.status === 'NG').map((m) => m.dimensionName).join(', ')}
                  </td>
                  <td className="py-2.5 pr-4 text-xs">{new Date(r.timestamp).toLocaleString('id-ID')}</td>
                </tr>
              ))}
              {recentNG.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted-foreground)]">
                    Belum ada part NG dari backend.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
