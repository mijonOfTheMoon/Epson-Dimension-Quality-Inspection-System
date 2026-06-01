<script lang="ts">
  import { ChevronDown, Edit3, Plus, Search, Trash2 } from 'lucide-svelte';
  import { navigate } from 'svelte-routing';
  import { useParts } from '$lib/hooks/useParts.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { DimensionKind, DimensionView, PartType } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

  const KIND_LABELS: Record<DimensionKind, string> = {
    width: 'Lebar',
    length: 'Panjang',
    diameter: 'Diameter',
    outer_diameter: 'Diameter luar',
    inner_diameter: 'Diameter dalam',
    hole_diameter: 'Diameter lubang',
  };

  const VIEW_LABELS: Record<DimensionView, string> = {
    top: 'Tampak Atas',
    side: 'Tampak Samping',
  };

  const parts = useParts();

  let search = $state('');
  let vendorFilter = $state('');
  let expandedId = $state<string | null>(null);
  let error = $state<string | null>(null);

  const vendors = $derived([...new Set(parts.data.map((part) => part.vendor))].sort());

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return parts.data.filter((part) => {
      if (vendorFilter && part.vendor !== vendorFilter) return false;
      if (!q) return true;
      return part.partName.toLowerCase().includes(q)
        || part.partCode.toLowerCase().includes(q)
        || part.vendor.toLowerCase().includes(q);
    });
  });

  const viewSummary = (part: PartType) => {
    const top = part.dimensions.filter((dimension) => dimension.view === 'top').length;
    const side = part.dimensions.filter((dimension) => dimension.view === 'side').length;
    if (top > 0 && side > 0) return `Atas ${top} / Samping ${side}`;
    if (side > 0) return `Samping ${side}`;
    return `Atas ${top}`;
  };

  const remove = async (part: PartType) => {
    if (!window.confirm(`Hapus part ${part.partCode}?`)) return;
    error = null;
    try {
      await api.deletePart(part.id);
      parts.reload();
      if (expandedId === part.id) expandedId = null;
    } catch (err) {
      error = getErrorMessage(err);
    }
  };
</script>

<div class="space-y-6 select-none font-sans">
  <!-- Page Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Konfigurasi Part</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1.5 font-medium">Pengelolaan master data spesifikasi toleransi dimensi produk untuk standardisasi QC.</p>
    </div>
    <button
      onclick={() => navigate('/part-configuration/new')}
      class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium self-start sm:self-auto shrink-0"
    >
      <Plus class="w-4 h-4" /> Part Baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if parts.error}<Notice text={parts.error} />{/if}

  {#if parts.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat data spesifikasi part...</span>
    </div>
  {/if}

  <!-- Filters Search Panel -->
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1 min-w-[240px]">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        bind:value={search}
        class="input pl-10 pr-4 py-2.5"
        placeholder="Cari part, kode, atau vendor..."
      />
    </div>
    <select bind:value={vendorFilter} class="input min-w-[160px] w-auto py-2.5 px-3">
      <option value="">Semua Vendor</option>
      {#each vendors as vendor (vendor)}
        <option value={vendor}>{vendor}</option>
      {/each}
    </select>
  </div>

  <!-- Found Counts Info -->
  <div class="text-xs text-[var(--muted-foreground)] font-bold tracking-wide bg-slate-100/50 dark:bg-slate-900/30 border border-[var(--border)] w-fit px-3 py-1.5 rounded-lg shadow-sm">
    Ditemukan: <span class="text-indigo-500 font-mono-data">{filtered.length}</span> item part
  </div>

  <!-- Master Part Table List -->
  <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
            <th class="px-5 py-4">Kode Part</th>
            <th class="px-5 py-4">Nama Produk</th>
            <th class="px-5 py-4">Vendor Partner</th>
            <th class="px-5 py-4 text-center">Jumlah Dimensi</th>
            <th class="px-5 py-4">Perspektif Kamera</th>
            <th class="px-5 py-4 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-200">
          {#each filtered as part (part.id)}
            {@const isExpanded = expandedId === part.id}
            <tr
              class="cursor-pointer transition-premium duration-150 {isExpanded ? 'bg-indigo-500/5 dark:bg-indigo-950/20' : 'hover:bg-slate-50/50 dark:hover:bg-slate-900/10'}"
              onclick={() => expandedId = isExpanded ? null : part.id}
            >
              <td class="px-5 py-3.5 font-bold font-mono-data text-xs text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{part.partCode}</td>
              <td class="px-5 py-3.5 font-bold text-slate-900 dark:text-white">{part.partName}</td>
              <td class="px-5 py-3.5 font-semibold text-slate-600 dark:text-slate-300">{part.vendor}</td>
              <td class="px-5 py-3.5 text-center font-bold font-mono-data text-xs">{part.dimensions.length}</td>
              <td class="px-5 py-3.5 text-xs text-slate-500 dark:text-slate-400 font-semibold">{viewSummary(part)}</td>
              <td class="px-5 py-3.5" onclick={(event) => event.stopPropagation()}>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onclick={() => navigate(`/part-configuration/${part.id}/edit`)}
                    class="p-2 border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-xl transition-premium shadow-sm text-slate-500 dark:text-slate-400"
                    title="Edit spesifikasi part"
                  >
                    <Edit3 class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onclick={() => void remove(part)}
                    class="p-2 border border-rose-500/10 hover:bg-rose-500/10 rounded-xl transition-premium shadow-sm text-rose-500"
                    title="Hapus part"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onclick={() => expandedId = isExpanded ? null : part.id}
                    class="p-2 border border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-premium text-slate-500 dark:text-slate-400"
                  >
                    <ChevronDown class="w-4 h-4 transition-transform duration-300 {isExpanded ? 'rotate-180' : ''}" />
                  </button>
                </div>
              </td>
            </tr>
            {#if isExpanded}
              <tr>
                <td colspan="6" class="px-5 py-5 bg-slate-50/50 dark:bg-slate-900/20 border-t border-b border-[var(--border)]">
                  <div class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-inner">
                    <table class="w-full text-xs">
                      <thead>
                        <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 border-b border-[var(--border)] text-left font-bold text-[10px] uppercase tracking-wider">
                          <th class="px-4 py-3">Nama Dimensi</th>
                          <th class="px-4 py-3">Sudut Kamera</th>
                          <th class="px-4 py-3">Kategori</th>
                          <th class="px-4 py-3 text-right">Nilai Nominal</th>
                          <th class="px-4 py-3 text-right">Batas Bawah (Min)</th>
                          <th class="px-4 py-3 text-right">Batas Atas (Max)</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-300 font-semibold font-mono-data">
                        {#each part.dimensions as dimension (dimension.id)}
                          <tr class="hover:bg-slate-50/30 dark:hover:bg-slate-900/10">
                            <td class="px-4 py-2.5 font-bold font-sans text-slate-900 dark:text-white">{dimension.name}</td>
                            <td class="px-4 py-2.5 font-sans">{VIEW_LABELS[dimension.view]}</td>
                            <td class="px-4 py-2.5 font-sans">{KIND_LABELS[dimension.kind]}</td>
                            <td class="px-4 py-2.5 text-right text-slate-900 dark:text-white font-bold">{dimension.nominal} {dimension.unit}</td>
                            <td class="px-4 py-2.5 text-right text-rose-500">{dimension.lowerLimit} {dimension.unit}</td>
                            <td class="px-4 py-2.5 text-right text-emerald-500">{dimension.upperLimit} {dimension.unit}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            {/if}
          {/each}

          {#if !parts.loading && filtered.length === 0}
            <tr>
              <td colspan="6" class="px-5 py-16 text-center text-[var(--muted-foreground)] font-medium">
                Tidak ditemukan part terdaftar yang cocok dengan filter pencarian.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
