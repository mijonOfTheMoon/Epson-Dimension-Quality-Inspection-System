<script lang="ts">
  import { Plus, Save, Trash2, XCircle } from 'lucide-svelte';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { DimensionKind, DimensionSpec, DimensionView, PartType } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

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

  const parts = useParts();

  let editingId = $state<string | null>(null);
  let form = $state<Omit<PartType, 'id'>>(emptyForm());
  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (editingId && !parts.data.some((part) => part.id === editingId)) {
      editingId = null;
      form = emptyForm();
    }
  });

  const editPart = (part: PartType) => {
    editingId = part.id;
    form = {
      partName: part.partName,
      partCode: part.partCode,
      vendor: part.vendor,
      dimensions: part.dimensions.length ? part.dimensions.map((d) => ({ ...d })) : [emptyDimension()],
    };
    error = null;
  };

  const reset = () => {
    editingId = null;
    form = emptyForm();
    error = null;
  };

  const save = async () => {
    saving = true;
    error = null;
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
      reset();
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      saving = false;
    }
  };

  const remove = async (part: PartType) => {
    if (!window.confirm(`Hapus part ${part.partCode}?`)) return;
    error = null;
    try {
      await api.deletePart(part.id);
      parts.reload();
      if (editingId === part.id) reset();
    } catch (err) {
      error = getErrorMessage(err);
    }
  };

  const updateDimension = (index: number, patch: Partial<DimensionSpec>) => {
    form = {
      ...form,
      dimensions: form.dimensions.map((d, i) => i === index ? { ...d, ...patch } : d),
    };
  };

  const addDimension = () => {
    form = { ...form, dimensions: [...form.dimensions, emptyDimension()] };
  };

  const removeDimension = (index: number) => {
    if (form.dimensions.length <= 1) return;
    form = { ...form, dimensions: form.dimensions.filter((_, i) => i !== index) };
  };
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1>Konfigurasi Part</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">
        Atur spesifikasi dimensi 2D untuk tampak atas dan tampak samping.
      </p>
    </div>
    <button onclick={reset} class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]">
      <Plus class="w-4 h-4" /> Part baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if parts.error}<Notice text={parts.error} />{/if}

  <div class="grid xl:grid-cols-[380px_1fr] gap-4">
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div class="p-4 border-b border-[var(--border)]">
        <h3 class="text-sm">Daftar Part</h3>
      </div>
      <div class="divide-y divide-[var(--border)]">
        {#each parts.data as part (part.id)}
          <div class="p-4 {editingId === part.id ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}">
            <div class="flex items-start justify-between gap-3">
              <button onclick={() => editPart(part)} class="text-left min-w-0">
                <div class="font-medium truncate">{part.partName}</div>
                <div class="text-xs text-[var(--muted-foreground)] truncate">{part.partCode} - {part.vendor}</div>
                <div class="text-[11px] text-[var(--muted-foreground)] mt-1">{part.dimensions.length} dimensi</div>
              </button>
              <button onclick={() => remove(part)} class="p-1.5 rounded-md text-red-600 hover:bg-red-50" aria-label="Hapus part">
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        {/each}
        {#if !parts.loading && parts.data.length === 0}
          <div class="p-8 text-center text-sm text-[var(--muted-foreground)]">Belum ada part.</div>
        {/if}
      </div>
    </section>

    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
      <div class="grid md:grid-cols-3 gap-3">
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Nama part</span>
          <input bind:value={form.partName} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Kode part</span>
          <input bind:value={form.partCode} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Vendor</span>
          <input bind:value={form.vendor} class="input" />
        </label>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm">Dimensi</h3>
          <p class="text-xs text-[var(--muted-foreground)] mt-0.5">
            Thickness disimpan sebagai tampak samping dengan kind width/length sesuai orientasi part.
          </p>
        </div>
        <button onclick={addDimension} class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs">
          <Plus class="w-3.5 h-3.5" /> Tambah dimensi
        </button>
      </div>

      <div class="space-y-3">
        {#each form.dimensions as dimension, index (dimension.id)}
          <div class="rounded-lg border border-[var(--border)] p-3 space-y-3">
            <div class="grid md:grid-cols-[1fr_150px_150px_80px] gap-2">
              <input
                value={dimension.name}
                oninput={(e) => updateDimension(index, { name: (e.currentTarget as HTMLInputElement).value })}
                placeholder="Nama dimensi"
                class="input"
              />
              <select
                value={dimension.kind}
                onchange={(e) => updateDimension(index, { kind: (e.currentTarget as HTMLSelectElement).value as DimensionKind })}
                class="input"
              >
                {#each KIND_OPTIONS as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
              <select
                value={dimension.view}
                onchange={(e) => updateDimension(index, { view: (e.currentTarget as HTMLSelectElement).value as DimensionView })}
                class="input"
              >
                {#each VIEW_OPTIONS as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
              <input
                value={dimension.unit}
                oninput={(e) => updateDimension(index, { unit: (e.currentTarget as HTMLInputElement).value })}
                class="input"
              />
            </div>
            <div class="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <input
                type="number" step="0.001" value={dimension.nominal}
                oninput={(e) => updateDimension(index, { nominal: Number((e.currentTarget as HTMLInputElement).value) })}
                placeholder="Nominal" class="input"
              />
              <input
                type="number" step="0.001" value={dimension.lowerLimit}
                oninput={(e) => updateDimension(index, { lowerLimit: Number((e.currentTarget as HTMLInputElement).value) })}
                placeholder="Lower" class="input"
              />
              <input
                type="number" step="0.001" value={dimension.upperLimit}
                oninput={(e) => updateDimension(index, { upperLimit: Number((e.currentTarget as HTMLInputElement).value) })}
                placeholder="Upper" class="input"
              />
              <button
                onclick={() => removeDimension(index)}
                class="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-red-600 border border-red-200 hover:bg-red-50 text-xs"
              >
                <XCircle class="w-4 h-4" /> Hapus
              </button>
            </div>
            <div class="text-[11px] text-[var(--muted-foreground)]">
              {KIND_OPTIONS.find((opt) => opt.value === dimension.kind)?.note ?? ''}
            </div>
          </div>
        {/each}
      </div>

      <button disabled={saving} onclick={save} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
        <Save class="w-4 h-4" /> {editingId ? 'Simpan perubahan' : 'Buat part'}
      </button>
    </section>
  </div>
</div>
