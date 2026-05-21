import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Save, Trash2, XCircle } from 'lucide-react';
import { useParts } from '../hooks/useParts';
import { api, getErrorMessage } from '../services/api';
import type { DimensionKind, DimensionSpec, DimensionView, PartType } from '../types/api';

const KIND_OPTIONS: { value: DimensionKind; label: string; note: string }[] = [
  { value: 'width', label: 'Width', note: 'Lebar horizontal pada view aktif' },
  { value: 'length', label: 'Length', note: 'Panjang vertikal pada view aktif' },
  { value: 'diameter', label: 'Diameter', note: 'Diameter umum dari lingkar luar' },
  { value: 'outer_diameter', label: 'Outer diameter', note: 'Diameter luar' },
  { value: 'inner_diameter', label: 'Inner diameter', note: 'Diameter lubang/area dalam' },
  { value: 'hole_diameter', label: 'Hole diameter', note: 'Alias untuk diameter lubang' },
];

const VIEW_OPTIONS: { value: DimensionView; label: string }[] = [
  { value: 'top', label: 'Tampak Atas' },
  { value: 'side', label: 'Tampak Samping' },
];

const emptyDimension = (): DimensionSpec => ({
  id: `dim-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  name: 'Width',
  kind: 'width',
  view: 'top',
  nominal: 0,
  lowerLimit: 0,
  upperLimit: 0,
  unit: 'mm',
});

const emptyForm = (): Omit<PartType, 'id'> => ({
  partName: '',
  partCode: '',
  vendor: '',
  dimensions: [emptyDimension()],
});

export function PartConfigurationPage() {
  const parts = useParts();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PartType, 'id'>>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingId && !parts.data.some((part) => part.id === editingId)) {
      setEditingId(null);
      setForm(emptyForm());
    }
  }, [editingId, parts.data]);

  const editPart = (part: PartType) => {
    setEditingId(part.id);
    setForm({
      partName: part.partName,
      partCode: part.partCode,
      vendor: part.vendor,
      dimensions: part.dimensions.length ? part.dimensions : [emptyDimension()],
    });
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        dimensions: form.dimensions.map((dimension) => ({
          ...dimension,
          nominal: Number(dimension.nominal),
          lowerLimit: Number(dimension.lowerLimit),
          upperLimit: Number(dimension.upperLimit),
        })),
      };
      if (editingId) await api.updatePart(editingId, payload);
      else await api.createPart(payload);
      parts.reload();
      setEditingId(null);
      setForm(emptyForm());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (part: PartType) => {
    if (!window.confirm(`Hapus part ${part.partCode}?`)) return;
    setError(null);
    try {
      await api.deletePart(part.id);
      parts.reload();
      if (editingId === part.id) {
        setEditingId(null);
        setForm(emptyForm());
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const updateDimension = (index: number, patch: Partial<DimensionSpec>) => {
    setForm((current) => ({
      ...current,
      dimensions: current.dimensions.map((dimension, itemIndex) => itemIndex === index ? { ...dimension, ...patch } : dimension),
    }));
  };

  const removeDimension = (index: number) => {
    setForm((current) => ({
      ...current,
      dimensions: current.dimensions.length === 1
        ? current.dimensions
        : current.dimensions.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1>Konfigurasi Part</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Atur spesifikasi dimensi 2D untuk tampak atas dan tampak samping.
          </p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm(emptyForm()); setError(null); }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]"
        >
          <Plus className="w-4 h-4" /> Part baru
        </button>
      </div>

      {error && <Notice text={error} />}
      {parts.error && <Notice text={parts.error} />}

      <div className="grid xl:grid-cols-[380px_1fr] gap-4">
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-sm">Daftar Part</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {parts.data.map((part) => (
              <div key={part.id} className={`p-4 ${editingId === part.id ? 'bg-blue-50/60' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => editPart(part)} className="text-left min-w-0">
                    <div className="font-medium truncate">{part.partName}</div>
                    <div className="text-xs text-[var(--muted-foreground)] truncate">{part.partCode} - {part.vendor}</div>
                    <div className="text-[11px] text-[var(--muted-foreground)] mt-1">
                      {part.dimensions.length} dimensi
                    </div>
                  </button>
                  <button onClick={() => void remove(part)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {!parts.loading && parts.data.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">Belum ada part.</div>
            )}
          </div>
        </section>

        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Nama part">
              <input value={form.partName} onChange={(e) => setForm((current) => ({ ...current, partName: e.target.value }))} className="input" />
            </Field>
            <Field label="Kode part">
              <input value={form.partCode} onChange={(e) => setForm((current) => ({ ...current, partCode: e.target.value }))} className="input" />
            </Field>
            <Field label="Vendor">
              <input value={form.vendor} onChange={(e) => setForm((current) => ({ ...current, vendor: e.target.value }))} className="input" />
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm">Dimensi</h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                Thickness disimpan sebagai tampak samping dengan kind width/length sesuai orientasi part.
              </p>
            </div>
            <button
              onClick={() => setForm((current) => ({ ...current, dimensions: [...current.dimensions, emptyDimension()] }))}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah dimensi
            </button>
          </div>

          <div className="space-y-3">
            {form.dimensions.map((dimension, index) => (
              <div key={dimension.id} className="rounded-lg border border-[var(--border)] p-3 space-y-3">
                <div className="grid md:grid-cols-[1fr_150px_150px_80px] gap-2">
                  <input value={dimension.name} onChange={(e) => updateDimension(index, { name: e.target.value })} placeholder="Nama dimensi" className="input" />
                  <select value={dimension.kind} onChange={(e) => updateDimension(index, { kind: e.target.value as DimensionKind })} className="input">
                    {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={dimension.view} onChange={(e) => updateDimension(index, { view: e.target.value as DimensionView })} className="input">
                    {VIEW_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input value={dimension.unit} onChange={(e) => updateDimension(index, { unit: e.target.value })} className="input" />
                </div>
                <div className="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <input type="number" step="0.001" value={dimension.nominal} onChange={(e) => updateDimension(index, { nominal: Number(e.target.value) })} placeholder="Nominal" className="input" />
                  <input type="number" step="0.001" value={dimension.lowerLimit} onChange={(e) => updateDimension(index, { lowerLimit: Number(e.target.value) })} placeholder="Lower" className="input" />
                  <input type="number" step="0.001" value={dimension.upperLimit} onChange={(e) => updateDimension(index, { upperLimit: Number(e.target.value) })} placeholder="Upper" className="input" />
                  <button onClick={() => removeDimension(index)} className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-red-600 border border-red-200 hover:bg-red-50 text-xs">
                    <XCircle className="w-4 h-4" /> Hapus
                  </button>
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {KIND_OPTIONS.find((option) => option.value === dimension.kind)?.note}
                </div>
              </div>
            ))}
          </div>

          <button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {editingId ? 'Simpan perubahan' : 'Buat part'}
          </button>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{text}</div>;
}
