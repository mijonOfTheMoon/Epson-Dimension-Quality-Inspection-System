import { inspectionResults, partTypes } from '../data/mock-data';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { CheckCircle, XCircle, Activity, TrendingDown, Package } from 'lucide-react';

export function DashboardPage() {
  const total = inspectionResults.length;
  const ok = inspectionResults.filter((r) => r.status === 'OK').length;
  const ng = inspectionResults.filter((r) => r.status === 'NG').length;
  const ngRate = ((ng / total) * 100).toFixed(1);

  // NG by part type
  const ngByPart = partTypes.map((pt) => {
    const partResults = inspectionResults.filter((r) => r.partCode === pt.partCode);
    const partNG = partResults.filter((r) => r.status === 'NG').length;
    return { name: pt.partName, ng: partNG, ok: partResults.length - partNG };
  });

  // Daily trend
  const dailyMap = new Map<string, { date: string; ok: number; ng: number }>();
  inspectionResults.forEach((r) => {
    const d = r.timestamp.slice(0, 10);
    if (!dailyMap.has(d)) dailyMap.set(d, { date: d, ok: 0, ng: 0 });
    const entry = dailyMap.get(d)!;
    if (r.status === 'OK') entry.ok++;
    else entry.ng++;
  });
  const dailyTrend = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // By shift
  const shiftData = ['A', 'B', 'C'].map((s) => {
    const sr = inspectionResults.filter((r) => r.shift === s);
    return { shift: `Shift ${s}`, total: sr.length, ng: sr.filter((r) => r.status === 'NG').length };
  });

  // Pie data
  const pieData = [
    { name: 'OK', value: ok, color: '#22c55e' },
    { name: 'NG', value: ng, color: '#ef4444' },
  ];

  // Recent NG
  const recentNG = inspectionResults.filter((r) => r.status === 'NG').slice(0, 5);

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

      {/* KPI Cards */}
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

      {/* Charts Row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* NG Rate Trend */}
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

        {/* Pie */}
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

      {/* Second Row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* By Part Type */}
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

        {/* By Shift */}
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

      {/* Recent NG */}
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
