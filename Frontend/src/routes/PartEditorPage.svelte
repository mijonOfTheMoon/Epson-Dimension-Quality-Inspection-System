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

<div class="space-y-5">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <button onclick={() => navigate('/part-configuration')} class="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2">
        <ArrowLeft class="w-4 h-4" /> Back
      </button>
      <h1>{isEdit ? 'Edit Part' : 'Tambah Part'}</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">Master part dan batas ukur inspeksi.</p>
    </div>
    <div class="flex items-center gap-2">
      <button onclick={() => navigate('/part-configuration')} class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]">
        <X class="w-4 h-4" /> Batal
      </button>
      <button disabled={saving || notFound} onclick={save} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
        <Save class="w-4 h-4" /> Simpan
      </button>
    </div>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if parts.error}<Notice text={parts.error} />{/if}

  {#if parts.loading && isEdit}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat data part...
    </div>
  {:else if notFound}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
      Part tidak ditemukan.
    </div>
  {:else}
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
      <h3 class="text-sm">Informasi Part</h3>
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
    </section>

    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div class="p-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h3 class="text-sm">Spesifikasi Dimensi</h3>
        <button onclick={addDimension} class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700">
          <Plus class="w-3.5 h-3.5" /> Tambah dimensi
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[920px]">
          <thead class="bg-[var(--accent)] text-left">
            <tr>
              <th class="px-3 py-3 w-[190px]">Dimensi</th>
              <th class="px-3 py-3 w-[150px]">View</th>
              <th class="px-3 py-3 w-[150px]">Tipe</th>
              <th class="px-3 py-3 w-[120px]">Nominal</th>
              <th class="px-3 py-3 w-[120px]">Min</th>
              <th class="px-3 py-3 w-[120px]">Max</th>
              <th class="px-3 py-3 w-[90px]">Unit</th>
              <th class="px-3 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {#each form.dimensions as dimension, index (dimension.id)}
              <tr class="border-t border-[var(--border)] align-top">
                <td class="px-3 py-2">
                  <input
                    value={dimension.name}
                    oninput={(event) => updateDimension(index, { name: (event.currentTarget as HTMLInputElement).value })}
                    class="input"
                  />
                </td>
                <td class="px-3 py-2">
                  <select
                    value={dimension.view}
                    onchange={(event) => updateDimension(index, { view: (event.currentTarget as HTMLSelectElement).value as DimensionView })}
                    class="input"
                  >
                    {#each VIEW_OPTIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </td>
                <td class="px-3 py-2">
                  <select
                    value={dimension.kind}
                    onchange={(event) => updateDimension(index, { kind: (event.currentTarget as HTMLSelectElement).value as DimensionKind })}
                    class="input"
                  >
                    {#each KIND_OPTIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </td>
                <td class="px-3 py-2">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.nominal}
                    oninput={(event) => updateDimension(index, { nominal: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right"
                  />
                </td>
                <td class="px-3 py-2">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.min}
                    oninput={(event) => updateDimension(index, { min: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right"
                  />
                </td>
                <td class="px-3 py-2">
                  <input
                    type="number"
                    step="0.001"
                    value={dimension.max}
                    oninput={(event) => updateDimension(index, { max: (event.currentTarget as HTMLInputElement).value })}
                    class="input text-right"
                  />
                </td>
                <td class="px-3 py-2">
                  <input
                    value={dimension.unit}
                    oninput={(event) => updateDimension(index, { unit: (event.currentTarget as HTMLInputElement).value })}
                    class="input"
                  />
                </td>
                <td class="px-3 py-2 text-right">
                  <button
                    disabled={form.dimensions.length <= 1}
                    onclick={() => removeDimension(index)}
                    class="p-2 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                    aria-label="Hapus dimensi"
                    title="Hapus dimensi"
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
