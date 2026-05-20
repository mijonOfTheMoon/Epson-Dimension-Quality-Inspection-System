import { useState } from 'react';
import { Package, ChevronDown, ChevronUp } from 'lucide-react';
import { useParts } from '../hooks/useParts';

export function PartsPage() {
  const parts = useParts();
  const partTypes = parts.data;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1>Konfigurasi Tipe Part</h1>
        <p className="text-[var(--muted-foreground)] text-sm mt-1">
          Spesifikasi dimensi per tipe part (read-only). Kelola via seed data Backend.
        </p>
      </div>

      {parts.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{parts.error}</span>
          <button onClick={parts.reload} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {parts.loading && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
          Memuat konfigurasi part dari backend...
        </div>
      )}

      <div className="space-y-3">
        {partTypes.map((pt) => (
          <div key={pt.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === pt.id ? null : pt.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--accent)]/50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Package className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{pt.partName}</div>
                  <div className="text-sm text-[var(--muted-foreground)]">{pt.partCode} | {pt.vendor} | {pt.dimensions.length} dimensi</div>
                </div>
              </div>
              {expanded === pt.id ? <ChevronUp className="w-5 h-5 text-[var(--muted-foreground)]" /> : <ChevronDown className="w-5 h-5 text-[var(--muted-foreground)]" />}
            </button>

            {expanded === pt.id && (
              <div className="border-t border-[var(--border)] p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--muted-foreground)] border-b border-[var(--border)]">
                      <th className="pb-2 pr-4">Nama Dimensi</th>
                      <th className="pb-2 pr-4">Nominal</th>
                      <th className="pb-2 pr-4">Lower Limit</th>
                      <th className="pb-2 pr-4">Upper Limit</th>
                      <th className="pb-2">Satuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pt.dimensions.map((d) => (
                      <tr key={d.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2.5 pr-4" style={{ fontWeight: 500 }}>{d.name}</td>
                        <td className="py-2.5 pr-4">{d.nominal}</td>
                        <td className="py-2.5 pr-4">{d.lowerLimit}</td>
                        <td className="py-2.5 pr-4">{d.upperLimit}</td>
                        <td className="py-2.5">{d.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        {!parts.loading && partTypes.length === 0 && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center text-[var(--muted-foreground)] text-sm">
            Belum ada konfigurasi part dari backend.
          </div>
        )}
      </div>
    </div>
  );
}
