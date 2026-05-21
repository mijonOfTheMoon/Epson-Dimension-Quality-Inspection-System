import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { Activity, CheckCircle, Radio, TrendingDown, XCircle } from 'lucide-react';
import { useDashboardSummary } from '../hooks/useDashboardSummary';

export function DashboardPage() {
  const summary = useDashboardSummary();
  const loading = summary.loading;
  const error = summary.error;

  const {
    total, ok, ng, ngRate, dailyTrend, activeStationCount, stationCount,
    stationTrend, partPareto, shiftSummary, measurementDrift,
  } = summary.data;

  const cards = [
    { label: 'Inspeksi', value: total, icon: Activity, color: 'blue' },
    { label: 'OK', value: ok, icon: CheckCircle, color: 'green' },
    { label: 'NG', value: ng, icon: XCircle, color: 'red' },
    { label: 'NG rate', value: `${ngRate.toFixed(1)}%`, icon: TrendingDown, color: 'orange' },
    { label: 'Station aktif', value: `${activeStationCount}/${stationCount}`, icon: Radio, color: 'blue' },
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
        <h1>Dashboard</h1>
        <p className="text-[var(--muted-foreground)] text-sm mt-1">Ringkasan kualitas hari ini.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={summary.reload} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-xl p-4 text-sm">
          Belum ada inspeksi.
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
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

      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard title="Tren harian" loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => String(v).slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="ok" stroke="#22c55e" name="OK" strokeWidth={2} />
              <Line type="monotone" dataKey="ng" stroke="#ef4444" name="NG" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Komposisi OK/NG" loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={[{ name: 'OK', value: ok }, { name: 'NG', value: ng }]} dataKey="value" nameKey="name" innerRadius={64} outerRadius={94}>
                <Cell fill="#22c55e" />
                <Cell fill="#ef4444" />
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="NG per part" loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={partPareto}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="partCode" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="ok" fill="#22c55e" name="OK" stackId="part" />
              <Bar dataKey="ng" fill="#ef4444" name="NG" stackId="part" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Station" loading={loading}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stationTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="stationId" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="ok" fill="#22c55e" name="OK" />
              <Bar dataKey="ng" fill="#ef4444" name="NG" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Shift" loading={loading}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={shiftSummary}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="shift" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" fill="#3b82f6" name="Total" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ngRate" fill="#f97316" name="NG rate %" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Drift dimensi" loading={loading}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={measurementDrift}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dimensionName" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="delta" fill="#8b5cf6" name="Delta" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, loading, children }: { title: string; loading: boolean; children: ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <h3 className="mb-4">{title}</h3>
      {loading ? <div className="h-[260px] bg-[var(--accent)] rounded animate-pulse" /> : children}
    </div>
  );
}
