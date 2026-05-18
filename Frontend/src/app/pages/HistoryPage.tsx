import { useState, useMemo } from 'react';
import { Search, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { useInspections } from '../hooks/useInspections';
import { useParts } from '../hooks/useParts';

export function HistoryPage() {
  const inspections = useInspections(1000);
  const parts = useParts();
  const inspectionResults = inspections.data;
  const partTypes = parts.data;
  const loading = inspections.loading || parts.loading;
  const error = inspections.error || parts.error;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'OK' | 'NG'>('all');
  const [partFilter, setPartFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 15;

  const filtered = useMemo(() => {
    return inspectionResults.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (partFilter !== 'all' && r.partCode !== partFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.id.toLowerCase().includes(q) || r.partName.toLowerCase().includes(q) || r.batchNo.toLowerCase().includes(q) || r.operatorName.toLowerCase().includes(q);
      }
      return true;
    });
  }, [inspectionResults, search, statusFilter, partFilter]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const exportCSV = () => {
    const headers = 'ID,Part,Part Code,Batch,Status,Operator,Shift,Line,Timestamp,Confidence\n';
    const rows = filtered.map((r) =>
      `${r.id},${r.partName},${r.partCode},${r.batchNo},${r.status},${r.operatorName},${r.shift},${r.line},${r.timestamp},${r.confidenceScore}`
    ).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inspection_report.csv';
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1>Riwayat Inspeksi</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">Traceability data hasil inspeksi</p>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm self-start">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => { inspections.reload(); parts.reload(); }} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {loading && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
          Memuat riwayat inspeksi dari backend...
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Cari ID, part, batch, operator..."
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
          className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm"
        >
          <option value="all">Semua Status</option>
          <option value="OK">OK</option>
          <option value="NG">NG</option>
        </select>
        <select
          value={partFilter}
          onChange={(e) => { setPartFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--card)] text-sm"
        >
          <option value="all">Semua Part</option>
          {partTypes.map((pt) => <option key={pt.id} value={pt.partCode}>{pt.partName}</option>)}
        </select>
      </div>

      <div className="text-sm text-[var(--muted-foreground)]">{filtered.length} hasil ditemukan</div>

      {/* Table */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--accent)]">
              <tr className="text-left">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Part</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Line</th>
                <th className="px-4 py-3">Waktu</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((r) => (
                <>
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--accent)]/50">
                    <td className="px-4 py-2.5" style={{ fontWeight: 500 }}>{r.id}</td>
                    <td className="px-4 py-2.5">
                      <div>{r.partName}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">{r.partCode} | {r.vendor}</div>
                    </td>
                    <td className="px-4 py-2.5">{r.batchNo}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'OK' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5">{r.confidenceScore}%</td>
                    <td className="px-4 py-2.5">{r.shift}</td>
                    <td className="px-4 py-2.5">{r.line}</td>
                    <td className="px-4 py-2.5 text-xs">{new Date(r.timestamp).toLocaleString('id-ID')}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="p-1 hover:bg-[var(--accent)] rounded">
                        {expandedId === r.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={9} className="px-4 py-3 bg-[var(--accent)]">
                        <div className="text-xs" style={{ fontWeight: 500 }}>Detail Pengukuran - Operator: {r.operatorName}</div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                          {r.measurements.map((m) => (
                            <div key={m.dimensionName} className={`p-2 rounded border ${m.status === 'OK' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                              <div className="text-xs text-[var(--muted-foreground)]">{m.dimensionName}</div>
                              <div className="text-sm" style={{ fontWeight: 500 }}>
                                <span className={m.status === 'OK' ? 'text-green-700' : 'text-red-700'}>{m.measured} {m.unit}</span>
                              </div>
                              <div className="text-[10px] text-[var(--muted-foreground)]">
                                Nominal: {m.nominal} | Range: {m.lowerLimit} ~ {m.upperLimit}
                              </div>
                            </div>
                          ))}
                        </div>
                        {r.ngAction && (
                          <div className="mt-2 text-xs">
                            Tindakan: <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">{r.ngAction}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!loading && paginated.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                    {inspectionResults.length === 0 ? 'Belum ada data inspeksi dari backend.' : 'Tidak ada data yang cocok dengan filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm disabled:opacity-50">Prev</button>
          <span className="text-sm text-[var(--muted-foreground)]">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
