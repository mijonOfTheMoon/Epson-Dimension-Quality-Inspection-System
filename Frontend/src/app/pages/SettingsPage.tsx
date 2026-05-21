import { useState } from 'react';
import { Clock, Package, Shield, Layers, Save, XCircle } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useParts } from '../hooks/useParts';
import { useShiftSchedules } from '../hooks/useShiftSchedules';
import { useBatches } from '../hooks/useBatches';
import { api, getErrorMessage } from '../services/api';

type SettingsTab = 'parts' | 'shifts' | 'batches' | 'users';

const tabs: { key: SettingsTab; label: string; icon: typeof Package }[] = [
  { key: 'parts', label: 'Part', icon: Package },
  { key: 'shifts', label: 'Shift', icon: Clock },
  { key: 'batches', label: 'Batch', icon: Layers },
  { key: 'users', label: 'User', icon: Shield },
];

export function SettingsPage() {
  const [active, setActive] = useState<SettingsTab>('parts');

  return (
    <div className="space-y-5">
      <div>
        <h1>Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Atur master data inspeksi.</p>
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

      {active === 'parts' && <PartSettings />}
      {active === 'shifts' && <ShiftSettings />}
      {active === 'batches' && <BatchSettings />}
      {active === 'users' && <UserSettings />}
    </div>
  );
}

function PartSettings() {
  const parts = useParts();
  return (
    <section className="grid md:grid-cols-2 gap-3">
      {parts.data.map((part) => (
        <div key={part.id} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{part.partName}</div>
              <div className="text-sm text-[var(--muted-foreground)]">{part.partCode} · {part.vendor}</div>
            </div>
            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">{part.dimensions.length} dimensi</span>
          </div>
          <div className="mt-4 space-y-2">
            {part.dimensions.map((dimension) => (
              <div key={dimension.id} className="flex items-center justify-between text-sm border-t border-[var(--border)] pt-2">
                <span>{dimension.name}</span>
                <span className="text-[var(--muted-foreground)]">{dimension.lowerLimit}–{dimension.upperLimit} {dimension.unit}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {!parts.loading && parts.data.length === 0 && <Empty text="Belum ada part." />}
    </section>
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
          <input name="label" defaultValue={shift.label} className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
          <input name="startTime" type="time" defaultValue={shift.startTime} className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
          <input name="endTime" type="time" defaultValue={shift.endTime} className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
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
        <input name="batchNo" placeholder="Batch no" className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
        <select name="partCode" className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm">
          {parts.data.map((part) => <option key={part.id} value={part.partCode}>{part.partCode}</option>)}
        </select>
        <select name="shift" className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm">
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
        <input name="targetQty" type="number" min="0" placeholder="Target" className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm" />
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

function UserSettings() {
  const users = useUsers();
  return (
    <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--accent)] text-left">
          <tr>
            <th className="px-4 py-3">Nama</th>
            <th className="px-4 py-3">Username</th>
            <th className="px-4 py-3">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.data.map((user) => (
            <tr key={user.id} className="border-t border-[var(--border)]">
              <td className="px-4 py-3">{user.name}</td>
              <td className="px-4 py-3 text-[var(--muted-foreground)]">{user.username}</td>
              <td className="px-4 py-3">{user.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 text-sm text-[var(--muted-foreground)]">{text}</div>;
}

function Notice({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{text}</div>;
}
