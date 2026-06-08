<script lang="ts">
  import { X } from 'lucide-svelte';

  let { emails = $bindable([]) }: { emails: string[] } = $props();

  let draft = $state('');
  let invalid = $state(false);

  const isValid = (value: string) => {
    const v = value.trim();
    if (!v || /\s/.test(v)) return false;
    const parts = v.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    return local.length > 0 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
  };

  const commit = () => {
    const value = draft.trim().replace(/,+$/, '').trim();
    if (!value) {
      draft = '';
      return;
    }
    if (!isValid(value) || emails.includes(value)) {
      invalid = true;
      return;
    }
    emails = [...emails, value];
    draft = '';
    invalid = false;
  };

  const removeAt = (index: number) => {
    emails = emails.filter((_, i) => i !== index);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      removeAt(emails.length - 1);
    }
  };

  const onInput = (event: Event) => {
    draft = (event.currentTarget as HTMLInputElement).value;
    invalid = false;
  };
</script>

<div class="flex flex-wrap items-center gap-1.5 rounded-xl border {invalid ? 'border-rose-400' : 'border-[var(--border)]'} bg-[var(--card)] px-2.5 py-2 focus-within:ring-2 focus-within:ring-indigo-500/30 transition-all">
  {#each emails as email, i (email)}
    <span class="inline-flex items-center gap-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-semibold pl-2 pr-1 py-1">
      {email}
      <button type="button" onclick={() => removeAt(i)} class="rounded p-0.5 hover:bg-indigo-500/20 transition-colors" aria-label="Hapus {email}">
        <X class="w-3 h-3" />
      </button>
    </span>
  {/each}
  <input
    value={draft}
    oninput={onInput}
    onkeydown={onKeydown}
    onblur={commit}
    class="flex-1 min-w-[140px] bg-transparent outline-none text-xs font-medium text-slate-800 dark:text-slate-100 placeholder:text-[var(--muted-foreground)] py-0.5"
    placeholder={emails.length === 0 ? 'Ketik email lalu tekan Enter' : 'Tambah email'}
  />
</div>
{#if invalid}
  <p class="text-[10px] font-medium text-rose-500 mt-1">Email tidak valid atau sudah ada.</p>
{/if}
