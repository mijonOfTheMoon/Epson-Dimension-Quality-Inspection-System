<script lang="ts">
  import { X, Send, Mail, MessageSquare, MessageCircle, Check, Share2 } from 'lucide-svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import EmailTagsInput from './EmailTagsInput.svelte';
  import type { InspectionStatus, ShareChannel, ShareRecapFilters } from '$lib/types/api';

  let {
    open,
    filters,
    scopeLabel,
    preview,
    onClose,
  }: {
    open: boolean;
    filters: ShareRecapFilters;
    scopeLabel: string;
    preview: { total: number; ok: number; ng: number };
    onClose: () => void;
  } = $props();

  type ChannelMeta = { id: ShareChannel; label: string; icon: typeof Send };
  const CHANNELS: ChannelMeta[] = [
    { id: 'telegram', label: 'Telegram', icon: Send },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'discord', label: 'Discord', icon: MessageSquare },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  ];

  let available = $state<string[]>([]);
  let loadingChannels = $state(true);
  let selected = $state<Record<string, boolean>>({});
  let emails = $state<string[]>([]);
  let sending = $state(false);
  let results = $state<Record<string, { ok: boolean; error?: string }> | null>(null);
  let loadedOnce = false;

  $effect(() => {
    if (!open) {
      loadedOnce = false;
      return;
    }
    if (loadedOnce) return;
    loadedOnce = true;
    selected = {};
    emails = [];
    results = null;
    loadingChannels = true;
    api.getShareChannels().then((channels) => {
      available = channels;
      loadingChannels = false;
    });
  });

  const visibleChannels = $derived(CHANNELS.filter((channel) => available.includes(channel.id)));
  const selectedIds = $derived(visibleChannels.map((c) => c.id).filter((id) => selected[id]));
  const emailSelected = $derived(Boolean(selected.email));

  const statusMode = $derived<InspectionStatus | undefined>(filters.status);
  const previewTitle = $derived(
    statusMode === 'NG' ? 'Rekap Temuan NG' : statusMode === 'OK' ? 'Rekap Lolos Inspeksi' : 'Rekap Inspeksi',
  );
  const ngRate = $derived(preview.total > 0 ? ((preview.ng / preview.total) * 100).toFixed(1) : '0.0');
  const previewStat = $derived(
    statusMode === 'NG'
      ? `${preview.ng} temuan NG`
      : statusMode === 'OK'
        ? `${preview.total} objek lolos`
        : `${preview.total} scan · ${preview.ok} OK · ${preview.ng} NG (${ngRate}%)`,
  );

  const canSend = $derived(
    !sending && selectedIds.length > 0 && (!emailSelected || emails.length > 0),
  );

  const toggle = (id: string) => {
    selected = { ...selected, [id]: !selected[id] };
  };

  const channelLabel = (id: string) => CHANNELS.find((c) => c.id === id)?.label ?? id;

  const send = async () => {
    if (!canSend) return;
    sending = true;
    results = null;
    try {
      const response = await api.shareRecap({
        channels: selectedIds as ShareChannel[],
        emailRecipients: emails,
        filters,
      });
      results = response.results;
      if (Object.values(response.results).every((r) => r.ok)) {
        setTimeout(onClose, 1200);
      }
    } catch (err) {
      results = { error: { ok: false, error: getErrorMessage(err) } };
    } finally {
      sending = false;
    }
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick={onClose} aria-label="Tutup"></button>
    <div class="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto scrollbar-thin rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div class="flex items-start justify-between gap-3 p-5 border-b border-[var(--border)]">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
            <Share2 class="w-[18px] h-[18px]" />
          </div>
          <div class="min-w-0">
            <h3 class="text-base font-bold text-slate-900 dark:text-white">Bagikan Rekap</h3>
            <p class="text-[11px] text-[var(--muted-foreground)] font-medium truncate">{preview.total} record · {scopeLabel}</p>
          </div>
        </div>
        <button onclick={onClose} class="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors shrink-0" aria-label="Tutup">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="p-5 space-y-5">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2.5">Kirim ke</p>
          {#if loadingChannels}
            <div class="grid grid-cols-2 gap-2.5">
              {#each [0, 1, 2, 3] as i (i)}
                <div class="h-[52px] rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"></div>
              {/each}
            </div>
          {:else if visibleChannels.length === 0}
            <div class="text-xs text-[var(--muted-foreground)] font-medium border border-dashed border-[var(--border)] rounded-xl p-4 text-center">
              Belum ada channel berbagi yang dikonfigurasi.
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-2.5">
              {#each visibleChannels as channel (channel.id)}
                {@const Icon = channel.icon}
                {@const active = selected[channel.id]}
                <button
                  type="button"
                  onclick={() => toggle(channel.id)}
                  class="relative flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-sm font-bold transition-premium {
                    active
                      ? 'border-indigo-500/40 bg-indigo-500/5 text-slate-900 dark:text-white'
                      : 'border-[var(--border)] text-slate-600 dark:text-slate-300 hover:bg-[var(--accent)]'
                  }"
                >
                  <Icon class="w-4 h-4 {active ? 'text-indigo-500' : 'text-[var(--muted-foreground)]'}" />
                  {channel.label}
                  {#if active}
                    <span class="absolute top-2 right-2 w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center">
                      <Check class="w-2.5 h-2.5" />
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if emailSelected}
          <div>
            <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Penerima Email</p>
            <EmailTagsInput bind:emails />
          </div>
        {/if}

        <div class="rounded-xl border border-[var(--border)] bg-slate-50/50 dark:bg-slate-900/20 p-3.5">
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Pratinjau</p>
          <p class="text-sm font-bold text-slate-900 dark:text-white">{previewTitle}</p>
          <p class="text-[11px] text-[var(--muted-foreground)] font-medium mt-0.5">{scopeLabel}</p>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-2 font-mono-data">{previewStat}</p>
        </div>

        {#if results}
          <div class="space-y-1.5">
            {#each Object.entries(results) as [channel, result] (channel)}
              <div class="flex items-center gap-2 text-xs font-semibold {result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
                {#if result.ok}<Check class="w-3.5 h-3.5 shrink-0" />{:else}<X class="w-3.5 h-3.5 shrink-0" />{/if}
                <span class="font-bold">{channelLabel(channel)}</span>
                <span class="text-[var(--muted-foreground)] font-medium truncate">{result.ok ? 'terkirim' : (result.error ?? 'gagal')}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2.5 p-5 border-t border-[var(--border)]">
        <button onclick={onClose} class="px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-[var(--accent)] transition-premium">
          Tutup
        </button>
        <button
          disabled={!canSend}
          onclick={send}
          class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium disabled:opacity-50 disabled:pointer-events-none"
        >
          {#if sending}
            <span class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>
            Mengirim...
          {:else}
            <Share2 class="w-4 h-4" /> Bagikan
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
