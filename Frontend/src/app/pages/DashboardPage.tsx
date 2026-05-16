import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { CheckCircle, XCircle, Activity, TrendingDown } from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useParts } from '../hooks/useParts';
import type { InspectionResult } from '../data/mock-data';

export function DashboardPage() {
  const inspectionResults = useInspections(1000);
  const partTypes = useParts();
  const { total, ok, ng, ngRate, ngByPart, dailyTrend, shiftData, pieData, recentNG } = useMemo(() => {
    let okCount = 0;
    let ngCount = 0;
    const dailyMap = new Map<string, { date: string; ok: number; ng: number }>();
    const partMap = new Map<string, { name: string; ok: number; ng: number }>(partTypes.map((pt) => [pt.partCode, { name: pt.partName, ok: 0, ng: 0 }]));
    const shiftMap = new Map<string, { shift: string; total: number; ng: number }>(['A', 'B', 'C'].map((shift) => [shift, { shift: `Shift ${shift}`, total: 0, ng: 0 }]));
    const latestNg: InspectionResult[] = [];

    for (const result of inspectionResults) {
      const isNg = result.status === 'NG';
      if (isNg) {
        ngCount += 1;
        if (latestNg.length < 5) latestNg.push(result);
      } else {
        okCount += 1;
      }

      const date = result.timestamp.slice(0, 10);
      let daily = dailyMap.get(date);
      if (!daily) {
        daily = { date, ok: 0, ng: 0 };
        dailyMap.set(date, daily);
      }
      if (isNg) daily.ng += 1;
      else daily.ok += 1;

      let part = partMap.get(result.partCode);
      if (!part) {
        part = { name: result.partName, ok: 0, ng: 0 };
        partMap.set(result.partCode, part);
      }
      if (isNg) part.ng += 1;
      else part.ok += 1;

      const shift = shiftMap.get(result.shift);
      if (shift) {
        shift.total += 1;
        if (isNg) shift.ng += 1;
      }
    }

    const totalCount = okCount + ngCount;

    return {
      total: totalCount,
      ok: okCount,
      ng: ngCount,
      ngRate: totalCount > 0 ? ((ngCount / totalCount) * 100).toFixed(1) : '0.0',
      ngByPart: [...partMap.values()],
      dailyTrend: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      shiftData: [...shiftMap.values()],
      pieData: [
        { name: 'OK', value: okCount, color: '#22c55e' },
        { name: 'NG', value: ngCount, color: '#ef4444' },
      ],
      recentNG: latestNg,
    };
  }, [inspectionResults, partTypes]);

  const cards = [
    { label: 'Total Inspeksi', value: total, icon: Activity, color: 'blue' },
    { label: 'Part OK', value: ok, icon: CheckCircle, color: 'green' },
    { label: 'Part NG', value: ng, icon: XCircle, color: 'red' },
    { label: 'NG Rate', value: `${ngRate}%`, icon: TrendingDown, color: 'orange' },
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-[var(--muted-foreground)]">{c.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[c.color]}`}>
                <c.icon className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl" style={{ fontWeight: 500 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="mb-4">Tren Inspeksi Harian</h3>
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
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="mb-4">Distribusi Status</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}>
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-green-500" /> OK: {ok}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-red-500" /> NG: {ng}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="mb-4">NG per Tipe Part</h3>
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
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="mb-4">Inspeksi per Shift</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={shiftData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="shift" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" fill="#3b82f6" name="Total" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ng" fill="#ef4444" name="NG" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
                <th className="pb-2 pr-4">Tindakan</th>
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
                  <td className="py-2.5 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.ngAction === 'hold' ? 'bg-yellow-100 text-yellow-700' : r.ngAction === 'return' ? 'bg-red-100 text-red-700' : r.ngAction === 'rework' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {r.ngAction}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
