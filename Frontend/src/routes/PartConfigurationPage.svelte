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

<div class="space-y-5">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1>Konfigurasi Part</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">Master part dan spesifikasi dimensi inspeksi.</p>
    </div>
    <button
      onclick={() => navigate('/part-configuration/new')}
      class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm self-start"
    >
      <Plus class="w-4 h-4" /> Part baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if parts.error}<Notice text={parts.error} />{/if}

  {#if parts.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat data part dari backend...
    </div>
  {/if}

  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
      <input
        bind:value={search}
        class="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
        placeholder="Cari part, kode, atau vendor..."
      />
    </div>
    <select bind:value={vendorFilter} class="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]">
      <option value="">Semua Vendor</option>
      {#each vendors as vendor (vendor)}
        <option value={vendor}>{vendor}</option>
      {/each}
    </select>
  </div>

  <div class="text-sm text-[var(--muted-foreground)]">{filtered.length} part ditemukan</div>

  <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--accent)] text-left">
            <th class="px-4 py-3">Kode</th>
            <th class="px-4 py-3">Part</th>
            <th class="px-4 py-3">Vendor</th>
            <th class="px-4 py-3 text-center">Dimensi</th>
            <th class="px-4 py-3">View</th>
            <th class="px-4 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as part (part.id)}
            {@const isExpanded = expandedId === part.id}
            <tr
              class="border-t border-[var(--border)] cursor-pointer transition-colors {isExpanded ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'hover:bg-[var(--accent)]/50'}"
              onclick={() => expandedId = isExpanded ? null : part.id}
            >
              <td class="px-4 py-3 whitespace-nowrap font-medium">{part.partCode}</td>
              <td class="px-4 py-3">
                <div class="font-medium">{part.partName}</div>
              </td>
              <td class="px-4 py-3">{part.vendor}</td>
              <td class="px-4 py-3 text-center">{part.dimensions.length}</td>
              <td class="px-4 py-3 text-xs text-[var(--muted-foreground)]">{viewSummary(part)}</td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onclick={(event) => { event.stopPropagation(); navigate(`/part-configuration/${part.id}/edit`); }}
                    class="p-1.5 rounded-md hover:bg-[var(--accent)]"
                    aria-label="Edit part"
                    title="Edit part"
                  >
                    <Edit3 class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onclick={(event) => { event.stopPropagation(); void remove(part); }}
                    class="p-1.5 rounded-md text-red-600 hover:bg-red-50"
                    aria-label="Hapus part"
                    title="Hapus part"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                  <ChevronDown class="w-4 h-4 text-[var(--muted-foreground)] transition-transform {isExpanded ? 'rotate-180' : ''}" />
                </div>
              </td>
            </tr>
            {#if isExpanded}
              <tr class="bg-blue-50/40 dark:bg-blue-950/20">
                <td colspan="6" class="px-4 py-4">
                  <div class="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
                    <table class="w-full text-xs">
                      <thead class="bg-[var(--accent)] text-left">
                        <tr>
                          <th class="px-3 py-2">Dimensi</th>
                          <th class="px-3 py-2">View</th>
                          <th class="px-3 py-2">Tipe</th>
                          <th class="px-3 py-2 text-right">Nominal</th>
                          <th class="px-3 py-2 text-right">Min</th>
                          <th class="px-3 py-2 text-right">Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each part.dimensions as dimension (dimension.id)}
                          <tr class="border-t border-[var(--border)]">
                            <td class="px-3 py-2 font-medium">{dimension.name}</td>
                            <td class="px-3 py-2">{VIEW_LABELS[dimension.view]}</td>
                            <td class="px-3 py-2">{KIND_LABELS[dimension.kind]}</td>
                            <td class="px-3 py-2 text-right">{dimension.nominal} {dimension.unit}</td>
                            <td class="px-3 py-2 text-right">{dimension.lowerLimit} {dimension.unit}</td>
                            <td class="px-3 py-2 text-right">{dimension.upperLimit} {dimension.unit}</td>
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
              <td colspan="6" class="px-4 py-12 text-center text-[var(--muted-foreground)]">
                Tidak ada part yang cocok.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
