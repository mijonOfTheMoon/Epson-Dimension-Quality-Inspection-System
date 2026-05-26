<script lang="ts">
  import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-svelte';
  import { navigate } from 'svelte-routing';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { DimensionKind, DimensionSpec, DimensionView, PartType } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

  let { id }: { id?: string } = $props();

  interface DimensionDraft {
    id: string;
    name: string;
    kind: DimensionKind;
    view: DimensionView;
    nominal: string;
    min: string;
    max: string;
    unit: string;
  }

  interface PartDraft {
    partName: string;
    partCode: string;
    vendor: string;
    dimensions: DimensionDraft[];
  }

  type PartPayload = Omit<PartType, 'id'>;
  type BuildResult = { ok: false; error: string } | { ok: true; payload: PartPayload };

  const KIND_OPTIONS: { value: DimensionKind; label: string }[] = [
    { value: 'width', label: 'Lebar' },
    { value: 'length', label: 'Panjang' },
    { value: 'diameter', label: 'Diameter' },
    { value: 'outer_diameter', label: 'Diameter luar' },
    { value: 'inner_diameter', label: 'Diameter dalam' },
    { value: 'hole_diameter', label: 'Diameter lubang' },
  ];

  const VIEW_OPTIONS: { value: DimensionView; label: string }[] = [
    { value: 'top', label: 'Tampak Atas' },
    { value: 'side', label: 'Tampak Samping' },
  ];

  const parts = useParts();
  const isEdit = $derived(Boolean(id));

  let form = $state<PartDraft>(emptyForm());
  let saving = $state(false);
  let error = $state<string | null>(null);
  let initializedFor = $state<string | null>(null);
  let notFound = $state(false);

  function newDimension(): DimensionDraft {
    return {
      id: `dim-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      name: '',
      kind: 'width',
      view: 'top',
      nominal: '',
      min: '',
      max: '',
      unit: 'mm',
    };
  }

  function emptyForm(): PartDraft {
    return {
      partName: '',
      partCode: '',
      vendor: '',
      dimensions: [newDimension()],
    };
  }

  function dimensionFromSpec(dimension: DimensionSpec): DimensionDraft {
    return {
      id: dimension.id,
      name: dimension.name,
      kind: dimension.kind,
      view: dimension.view,
      nominal: String(dimension.nominal),
      min: String(dimension.lowerLimit),
      max: String(dimension.upperLimit),
      unit: dimension.unit,
    };
  }

  function formFromPart(part: PartType): PartDraft {
    return {
      partName: part.partName,
      partCode: part.partCode,
      vendor: part.vendor,
      dimensions: part.dimensions.length ? part.dimensions.map(dimensionFromSpec) : [newDimension()],
    };
  }

  $effect(() => {
    const key = id ?? 'new';
    if (initializedFor === key) return;
    error = null;
    notFound = false;
    if (!id) {
      form = emptyForm();
      initializedFor = key;
      return;
    }
    if (parts.loading) return;
    const part = parts.data.find((item) => item.id === id);
    if (!part) {
      notFound = true;
      initializedFor = key;
      return;
    }
    form = formFromPart(part);
    initializedFor = key;
  });

  const updateDimension = (index: number, patch: Partial<DimensionDraft>) => {
    form = {
      ...form,
      dimensions: form.dimensions.map((dimension, i) => i === index ? { ...dimension, ...patch } : dimension),
    };
  };

  const addDimension = () => {
    form = { ...form, dimensions: [...form.dimensions, newDimension()] };
  };

  const removeDimension = (index: number) => {
    if (form.dimensions.length <= 1) return;
    form = { ...form, dimensions: form.dimensions.filter((_, i) => i !== index) };
  };

  const parseNumber = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const validateAndBuild = (): BuildResult => {
    if (!form.partName.trim()) return { ok: false, error: 'Nama part wajib diisi.' };
    if (!form.partCode.trim()) return { ok: false, error: 'Kode part wajib diisi.' };
    if (!form.vendor.trim()) return { ok: false, error: 'Vendor wajib diisi.' };
    if (form.dimensions.length === 0) return { ok: false, error: 'Minimal satu dimensi wajib diisi.' };

    const dimensions: DimensionSpec[] = [];
    for (const [index, dimension] of form.dimensions.entries()) {
      const row = index + 1;
      const nominal = parseNumber(dimension.nominal);
      const min = parseNumber(dimension.min);
      const max = parseNumber(dimension.max);
      if (!dimension.name.trim()) return { ok: false, error: `Nama dimensi baris ${row} wajib diisi.` };
      if (!dimension.unit.trim()) return { ok: false, error: `Unit baris ${row} wajib diisi.` };
      if (nominal === null || min === null || max === null) return { ok: false, error: `Nominal, Min, dan Max baris ${row} harus berupa angka.` };
      if (!(min <= nominal && nominal <= max)) return { ok: false, error: `Baris ${row}: Min harus <= Nominal dan Nominal harus <= Max.` };
      dimensions.push({
        id: dimension.id,
        name: dimension.name.trim(),
        kind: dimension.kind,
        view: dimension.view,
        nominal,
        lowerLimit: min,
        upperLimit: max,
        unit: dimension.unit.trim(),
      });
    }

    return {
      ok: true,
      payload: {
        partName: form.partName.trim(),
        partCode: form.partCode.trim(),
        vendor: form.vendor.trim(),
        dimensions,
      },
    };
  };

  const save = async () => {
    const result = validateAndBuild();
    if (!result.ok) {
      error = result.error;
      return;
    }

    saving = true;
    error = null;
    try {
      if (id) await api.updatePart(id, result.payload);
      else await api.createPart(result.payload);
      navigate('/part-configuration');
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      saving = false;
    }
  };
</script>

<div class="space-y-6 select-none font-sans">
  <!-- Top Navigation Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <button onclick={() => navigate('/part-configuration')} class="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2.5 transition-colors group">
        <ArrowLeft class="w-3.5 h-3.5 transition-transform group-hover:-translate-x-[2px]" /> Kembali
      </button>
      <h1 class="text-slate-900 dark:text-white tracking-tight">{isEdit ? 'Edit Spesifikasi Part' : 'Tambah Part Baru'}</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1.5 font-medium">Atur data master identitas produk beserta batas-batas toleransi ukur dimensi inspeksi.</p>
    </div>
    <!-- Top Bar Form Actions -->
    <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
      <button onclick={() => navigate('/part-configuration')} class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-xs font-bold hover:bg-[var(--accent)] text-slate-700 dark:text-slate-300 transition-premium shadow-sm">
        <X class="w-4 h-4" /> Batal
      </button>
      <button disabled={saving || notFound} onclick={save} class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none">
        {#if saving}
          <span class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>
          <span>Menyimpan...</span>
        {:else}
          <Save class="w-4 h-4" />
          <span>Simpan Data</span>
        {/if}
      </button>
    </div>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if parts.error}<Notice text={parts.error} />{/if}

  {#if parts.loading && isEdit}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat data spesifikasi part...</span>
    </div>
  {:else if notFound}
    <div class="bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-2xl p-4.5 text-sm font-semibold">
      Data master part tidak terdaftar di sistem.
    </div>
  {:else}
    <!-- Part Identity Form Section -->
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-4">
      <h3 class="text-base font-bold text-slate-900 dark:text-white border-b border-[var(--border)] pb-2">Identitas Produk</h3>
      <div class="grid md:grid-cols-3 gap-4">
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Nama Produk</span>
          <input bind:value={form.partName} class="input text-slate-900 dark:text-white font-semibold" placeholder="Brake Pad Set, dll." />
        </label>
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Kode Part</span>
          <input bind:value={form.partCode} class="input font-mono-data text-indigo-600 dark:text-indigo-400 font-bold" placeholder="EPS-002, dll." />
        </label>
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Nama Vendor Partner</span>
          <input bind:value={form.vendor} class="input text-slate-900 dark:text-white font-semibold" placeholder="PT. Epson Industry, dll." />
        </label>
      </div>
    </section>

    <!-- Dimension Specifications Grid Section -->
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
      <div class="p-4.5 border-b border-[var(--border)] flex items-center justify-between gap-3 bg-slate-50/30 dark:bg-slate-900/10">
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Batas Ukur &amp; Spesifikasi Dimensi</h3>
        <button onclick={addDimension} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:bg-indigo-500 hover:text-white transition-premium">
          <Plus class="w-4 h-4" /> Tambah Dimensi
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[960px]">
          <thead>
            <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
              <th class="px-4 py-3.5 w-[200px]">Nama Dimensi</th>
              <th class="px-4 py-3.5 w-[160px]">Sudut Kamera</th>
              <th class="px-4 py-3.5 w-[160px]">Kategori Ukur</th>
              <th class="px-4 py-3.5 w-[130px] text-right">Nominal Value</th>
              <th class="px-4 py-3.5 w-[130px] text-right">Min (Batas Bawah)</th>
              <th class="px-4 py-3.5 w-[130px] text-right">Max (Batas Atas)</th>
              <th class="px-4 py-3.5 w-[90px]">Satuan</th>
              <th class="px-4 py-3.5 w-12 text-right"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border)] align-middle">
            {#each form.dimensions as dimension, index (dimension.id)}
              <tr class="hover:bg-slate-50/30 dark:hover:bg-slate-900/5">
                <td class="px-3 py-2.5">
                  <input
                    value={dimension.name}
                    oninput={(event) => updateDimension(index, { name: (event.currentTarget as HTMLInputElement).value })}
                    class="input font-semibold"
                    placeholder="Contoh: Diameter Lubang"
                  />
                </td>
                <td class="px-3 py-2.5">
                  <select
                    value={dimension.view}
                    onchange={(event) => updateDimension(index, { view: (event.currentTarget as HTMLSelectElement).value as DimensionView })}
                    class="input font-semibold text-xs py-2.5"
                  >
                    {#each VIEW_OPTIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </td>
                <td class="px-3 py-2.5">
                  <select
                    value={dimension.kind}
                    onchange={(event) => updateDimension(index, { kind: (event.currentTarget as HTMLSelectElement).value as DimensionKind })}
                    class="input font-semibold text-xs py-2.5"
                  >
                    {#each KIND_OPTIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </td>
                <td class="px-3 py-2.5">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.nominal}
                    oninput={(event) => updateDimension(index, { nominal: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right font-mono-data font-bold"
                    placeholder="0.000"
                  />
                </td>
                <td class="px-3 py-2.5">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.min}
                    oninput={(event) => updateDimension(index, { min: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right font-mono-data font-bold text-rose-500"
                    placeholder="0.000"
                  />
                </td>
                <td class="px-3 py-2.5">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.max}
                    oninput={(event) => updateDimension(index, { max: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right font-mono-data font-bold text-emerald-500"
                    placeholder="0.000"
                  />
                </td>
                <td class="px-3 py-2.5">
                  <input
                    value={dimension.unit}
                    oninput={(event) => updateDimension(index, { unit: (event.currentTarget as HTMLInputElement).value })}
                    class="input font-semibold font-mono-data"
                    placeholder="mm"
                  />
                </td>
                <td class="px-3 py-2.5 text-right">
                  <button
                    disabled={form.dimensions.length <= 1}
                    onclick={() => removeDimension(index)}
                    class="p-2 border border-rose-500/10 hover:bg-rose-500/10 rounded-xl transition-premium text-rose-500 disabled:opacity-40 disabled:pointer-events-none shadow-sm"
                    title="Hapus baris dimensi"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>
