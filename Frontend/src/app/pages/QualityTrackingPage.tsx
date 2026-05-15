import { useState, Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  qualityTrackingRecords,
  type QualityTrackingRecord,
  type RequestStatus,
} from '../data/mock-data';
import {
  Search,
  ChevronDown,
  Send,
  Clock,
  Truck,
  CheckCircle2,
  Circle,
  AlertTriangle,
} from 'lucide-react';

const STATUS_CONFIG: Record<
  RequestStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  not_requested: { label: 'Not Requested', color: 'text-gray-600', bg: 'bg-gray-100', icon: Circle },
  requested: { label: 'Requested', color: 'text-blue-700', bg: 'bg-blue-100', icon: Send },
  in_progress: { label: 'In Progress', color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
  shipped: { label: 'Shipped', color: 'text-purple-700', bg: 'bg-purple-100', icon: Truck },
  received: { label: 'Received', color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2 },
};

export function QualityTrackingPage() {
  const { user } = useAuth();
  const role = user?.role;

  const [records, setRecords] = useState<QualityTrackingRecord[]>(() =>
    JSON.parse(JSON.stringify(qualityTrackingRecords))
  );
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const vendors = [...new Set(records.map((r) => r.vendor))];
  const dates = [...new Set(records.map((r) => r.date))].sort().reverse();

  const filtered = records.filter((r) => {
    const matchSearch =
      !search ||
      r.partName.toLowerCase().includes(search.toLowerCase()) ||
      r.partCode.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase());
    const matchDate = !filterDate || r.date === filterDate;
    const matchVendor = !filterVendor || r.vendor === filterVendor;
    return matchSearch && matchDate && matchVendor;
  });

  const canRequest = role === 'engineering' || role === 'admin';
  const canUpdateVendor = role === 'vendor' || role === 'admin';

  const handleStatusChange = (recordId: string, newStatus: RequestStatus) => {
    setRecords((prev) =>
      prev.map((r) => {
        if (r.id !== recordId) return r;
        return {
          ...r,
          requestStatus: newStatus,
          statusHistory: [
            ...r.statusHistory,
            {
              status: newStatus,
              timestamp: new Date().toISOString(),
              changedBy: user?.name || 'Unknown',
            },
          ],
        };
      })
    );
    showToast(`Status berhasil diubah ke "${STATUS_CONFIG[newStatus].label}"`);
  };

  const getActions = (r: QualityTrackingRecord) => {
    const actions: { label: string; status: RequestStatus; icon: React.ElementType }[] = [];
    const s = r.requestStatus;
    if (canRequest) {
      if (s === 'not_requested') actions.push({ label: 'Kirim Request ke Vendor', status: 'requested', icon: Send });
      if (s === 'shipped') actions.push({ label: 'Konfirmasi Diterima', status: 'received', icon: CheckCircle2 });
    }
    if (canUpdateVendor) {
      if (s === 'requested') actions.push({ label: 'Proses Permintaan', status: 'in_progress', icon: Clock });
      if (s === 'in_progress') actions.push({ label: 'Tandai Dikirim', status: 'shipped', icon: Truck });
    }
    return actions;
  };

  // Summary stats
  const todayStr = '2026-04-09';
  const todayRecords = records.filter((r) => r.date === todayStr);
  const totalScannedToday = todayRecords.reduce((s, r) => s + r.totalScanned, 0);
  const totalNGToday = todayRecords.reduce((s, r) => s + r.ngCount, 0);
  const avgNGRate = totalScannedToday > 0 ? ((totalNGToday / totalScannedToday) * 100).toFixed(1) : '0.0';
  const pendingRequests = records.filter((r) => r.requestStatus === 'requested' || r.requestStatus === 'in_progress').length;

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div>
        <h1>Quality Tracking</h1>
        <p className="text-[var(--muted-foreground)] text-sm mt-1">
          Monitoring NG ratio harian per part & manajemen permintaan part ke vendor
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="text-xs text-[var(--muted-foreground)]">Total Scan Hari Ini</div>
          <div className="text-2xl text-blue-700 mt-1" style={{ fontWeight: 500 }}>{totalScannedToday}</div>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="text-xs text-[var(--muted-foreground)]">Total NG Hari Ini</div>
          <div className="text-2xl text-red-600 mt-1" style={{ fontWeight: 500 }}>{totalNGToday}</div>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="text-xs text-[var(--muted-foreground)]">Rata-rata NG Rate</div>
          <div className={`text-2xl mt-1 ${parseFloat(avgNGRate) > 5 ? 'text-red-600' : 'text-green-600'}`} style={{ fontWeight: 500 }}>{avgNGRate}%</div>
        </div>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="text-xs text-[var(--muted-foreground)]">Request Pending</div>
          <div className="text-2xl text-amber-600 mt-1" style={{ fontWeight: 500 }}>{pendingRequests}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Cari part, kode, atau vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
          />
        </div>
        <select
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
        >
          <option value="">Semua Tanggal</option>
          {dates.map((d) => (
            <option key={d} value={d}>{new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</option>
          ))}
        </select>
        <select
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
        >
          <option value="">Semua Vendor</option>
          {vendors.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--accent)] text-left">
                <th className="px-4 py-3">Tanggal</th>
                <th className="px-4 py-3">Part</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-center">Total Scan</th>
                <th className="px-4 py-3 text-center">NG</th>
                <th className="px-4 py-3 text-center">NG Rate</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const statusCfg = STATUS_CONFIG[r.requestStatus];
                const StatusIcon = statusCfg.icon;
                const isExpanded = expandedRow === r.id;
                const actions = getActions(r);

                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-t border-[var(--border)] cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/60' : 'hover:bg-[var(--accent)]/50'}`}
                      onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(r.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div style={{ fontWeight: 500 }}>{r.partName}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{r.partCode}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{r.vendor}</td>
                      <td className="px-4 py-3 text-center">{r.totalScanned}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={r.ngCount > 0 ? 'text-red-600' : ''}>{r.ngCount}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                            r.ngRate > 5 ? 'bg-red-100 text-red-700' : r.ngRate > 2 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {r.ngRate > 5 && <AlertTriangle className="w-3 h-3" />}
                          {r.ngRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${statusCfg.bg} ${statusCfg.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ChevronDown
                          className={`w-4 h-4 text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="flex flex-col lg:flex-row gap-6">
                            {/* History timeline */}
                            <div className="flex-1">
                              <div className="text-xs text-[var(--muted-foreground)] mb-3" style={{ fontWeight: 500 }}>
                                Riwayat Perubahan Status
                              </div>
                              <div className="flex items-start gap-0">
                                {r.statusHistory.map((h, i) => {
                                  const hCfg = STATUS_CONFIG[h.status];
                                  const HIcon = hCfg.icon;
                                  const isLast = i === r.statusHistory.length - 1;
                                  const isCurrent = isLast;
                                  return (
                                    <div key={i} className="flex flex-col items-center relative" style={{ minWidth: 100, flex: 1 }}>
                                      {/* Connector line to previous */}
                                      {i > 0 && (
                                        <div className="absolute top-3 right-1/2 h-0.5 bg-gray-200 w-full -z-0" />
                                      )}
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 ${isCurrent ? hCfg.bg : 'bg-gray-100'} border-2 ${isCurrent ? 'border-current ' + hCfg.color : 'border-gray-200'}`}>
                                        <HIcon className={`w-3 h-3 ${isCurrent ? hCfg.color : 'text-gray-400'}`} />
                                      </div>
                                      <div className="mt-1.5 text-center">
                                        <div className={`text-[11px] ${isCurrent ? hCfg.color : 'text-gray-500'}`} style={{ fontWeight: isCurrent ? 500 : 400 }}>
                                          {hCfg.label}
                                        </div>
                                        <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                                          {new Date(h.timestamp).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        <div className="text-[10px] text-[var(--muted-foreground)]">
                                          {h.changedBy}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Action buttons */}
                            {actions.length > 0 && (
                              <div className="lg:border-l lg:border-[var(--border)] lg:pl-6 flex flex-col gap-2 items-center justify-center shrink-0">
                                {actions.map((a) => {
                                  const AIcon = a.icon;
                                  return (
                                    <button
                                      key={a.status}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStatusChange(r.id, a.status);
                                      }}
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors whitespace-nowrap w-fit"
                                    >
                                      <AIcon className="w-3.5 h-3.5" />
                                      {a.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                    Tidak ada data yang cocok dengan filter.
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