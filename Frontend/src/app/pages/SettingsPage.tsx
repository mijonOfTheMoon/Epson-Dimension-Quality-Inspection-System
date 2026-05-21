import { useState } from 'react';
import { Clock, Layers, Save, XCircle } from 'lucide-react';
import { useBatches } from '../hooks/useBatches';
import { useParts } from '../hooks/useParts';
import { useShiftSchedules } from '../hooks/useShiftSchedules';
import { api, getErrorMessage } from '../services/api';

type SettingsTab = 'shifts' | 'batches';

const tabs: { key: SettingsTab; label: string; icon: typeof Clock }[] = [
  { key: 'shifts', label: 'Shift', icon: Clock },
  { key: 'batches', label: 'Batch', icon: Layers },
];

export function SettingsPage() {
  const [active, setActive] = useState<SettingsTab>('shifts');

  return (
    <div className="space-y-5">
      <div>
        <h1>Pengaturan</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Atur jadwal shift dan batch aktif.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm ${active === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-[var(--card)] border-[var(--border)] hover:bg-[var(--accent)]'}`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {active === 'shifts' && <ShiftSettings />}
      {active === 'batches' && <BatchSettings />}
    </div>
  );
}

function ShiftSettings() {
  const shifts = useShiftSchedules();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (id: string, form: HTMLFormElement) => {
    setSaving(id);
    setError(null);
    try {
      const data = new FormData(form);
      await api.updateShiftSchedule(id, {
        label: String(data.get('label') ?? ''),
        startTime: String(data.get('startTime') ?? ''),
        endTime: String(data.get('endTime') ?? ''),
        active: data.get('active') === 'on',
      });
      shifts.reload();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="space-y-3">
      {error && <Notice text={error} />}
      {shifts.data.map((shift) => (
        <form
          key={shift.id}
          onSubmit={(event) => { event.preventDefault(); void save(shift.id, event.currentTarget); }}
          className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 grid gap-3 md:grid-cols-[120px_1fr_140px_140px_100px]"
        >
          <div className="font-medium">Shift {shift.shift}</div>
          <input name="label" defaultValue={shift.label} className="input" />
          <input name="startTime" type="time" defaultValue={shift.startTime} className="input" />
          <input name="endTime" type="time" defaultValue={shift.endTime} className="input" />
          <label className="flex items-center gap-2 text-sm">
            <input name="active" type="checkbox" defaultChecked={shift.active} /> Aktif
          </label>
          <button disabled={saving === shift.id} className="md:col-start-5 inline-flex justify-center items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> Simpan
          </button>
        </form>
      ))}
    </section>
  );
}

function BatchSettings() {
  const batches = useBatches();
  const parts = useParts();
  const [error, setError] = useState<string | null>(null);

  const openBatch = async (form: HTMLFormElement) => {
    setError(null);
    const data = new FormData(form);
    try {
      await api.openBatch({
        batchNo: String(data.get('batchNo') ?? ''),
        partCode: String(data.get('partCode') ?? ''),
        shift: String(data.get('shift') ?? 'A') as 'A' | 'B' | 'C',
        targetQty: Number(data.get('targetQty') ?? 0),
      });
      form.reset();
      batches.reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const close = async (id: string) => {
    try {
      await api.closeBatch(id);
      batches.reload();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <section className="space-y-4">
      {error && <Notice text={error} />}
      <form
        onSubmit={(event) => { event.preventDefault(); void openBatch(event.currentTarget); }}
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 grid gap-3 md:grid-cols-[1fr_1fr_100px_120px_auto]"
      >
        <input name="batchNo" placeholder="Batch no" className="input" />
        <select name="partCode" className="input">
          {parts.data.map((part) => <option key={part.id} value={part.partCode}>{part.partCode}</option>)}
        </select>
        <select name="shift" className="input">
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <input name="targetQty" type="number" min="0" placeholder="Target" className="input" />
        <button className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm">Buka batch</button>
      </form>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--accent)] text-left">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Part</th>
              <th className="px-4 py-3">Shift</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {batches.data.map((batch) => (
              <tr key={batch.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3">{batch.batchNo}</td>
                <td className="px-4 py-3">{batch.partName}</td>
                <td className="px-4 py-3">{batch.shift}</td>
                <td className="px-4 py-3">{batch.actualQty}/{batch.targetQty}</td>
                <td className="px-4 py-3">{batch.status === 'open' ? 'Aktif' : 'Selesai'}</td>
                <td className="px-4 py-3 text-right">
                  {batch.status === 'open' && (
                    <button onClick={() => void close(batch.id)} className="inline-flex items-center gap-1 text-red-600 text-xs">
                      <XCircle className="w-4 h-4" /> Tutup
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{text}</div>;
}
