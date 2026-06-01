<script lang="ts">
  import { Edit3, Plus, Search, Trash2 } from 'lucide-svelte';
  import { navigate } from 'svelte-routing';
  import { auth } from '$lib/stores/auth.svelte';
  import { useUsers } from '$lib/hooks/useUsers.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { User, UserRole } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

  const ROLE_LABELS: Record<UserRole, string> = {
    operator: 'Operator QC',
    qc: 'Quality Control',
    supervisor: 'Supervisor',
    engineering: 'Engineering',
    admin: 'Admin Sistem',
    vendor: 'Vendor',
  };

  const ROLES: UserRole[] = ['operator', 'qc', 'supervisor', 'engineering', 'admin', 'vendor'];

  const users = useUsers();

  let search = $state('');
  let roleFilter = $state<UserRole | ''>('');
  let error = $state<string | null>(null);

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return users.data.filter((user) => {
      if (roleFilter && user.role !== roleFilter) return false;
      if (!q) return true;
      return user.name.toLowerCase().includes(q)
        || user.username.toLowerCase().includes(q)
        || ROLE_LABELS[user.role].toLowerCase().includes(q);
    });
  });

  const initials = (user: User) => {
    const parts = user.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return (user.name[0] ?? user.username[0] ?? '').toUpperCase();
  };

  const remove = async (user: User) => {
    if (!window.confirm(`Hapus user ${user.username}?`)) return;
    error = null;
    try {
      await api.deleteUser(user.id);
      users.reload();
    } catch (err) {
      error = getErrorMessage(err);
    }
  };
</script>

<div class="space-y-6 select-none font-sans">
  <!-- Header Section -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-slate-900 dark:text-white tracking-tight">Manajemen User</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1.5 font-medium">Pengaturan akun kredensial, tingkat otorisasi, dan hak akses personel.</p>
    </div>
    <button
      onclick={() => navigate('/user-management/new')}
      class="inline-flex items-center justify-center gap-2 px-4.5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-500/10 active:scale-[0.98] transition-premium self-start sm:self-auto shrink-0"
    >
      <Plus class="w-4 h-4" /> User Baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if users.error}<Notice text={users.error} />{/if}

  {#if users.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat data personil user...</span>
    </div>
  {/if}

  <!-- Search and Select Filters -->
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1 min-w-[240px]">
      <Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        bind:value={search}
        class="input pl-10 pr-4 py-2.5"
        placeholder="Cari nama, username, atau role..."
      />
    </div>
    <select bind:value={roleFilter} class="input min-w-[160px] w-auto py-2.5 px-3">
      <option value="">Semua Tingkat Role</option>
      {#each ROLES as role (role)}
        <option value={role}>{ROLE_LABELS[role]}</option>
      {/each}
    </select>
  </div>

  <!-- Count Info -->
  <div class="text-xs text-[var(--muted-foreground)] font-bold tracking-wide bg-slate-100/50 dark:bg-slate-900/30 border border-[var(--border)] w-fit px-3 py-1.5 rounded-lg shadow-sm">
    Ditemukan: <span class="text-indigo-500 font-mono-data">{filtered.length}</span> personil user
  </div>

  <!-- Main Users Table Card -->
  <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-sm overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-b border-[var(--border)] text-left font-bold text-xs uppercase tracking-wider">
            <th class="px-5 py-4">Nama Personil</th>
            <th class="px-5 py-4">Username Kredensial</th>
            <th class="px-5 py-4">Hak Akses Role</th>
            <th class="px-5 py-4 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] text-slate-800 dark:text-slate-200">
          {#each filtered as user (user.id)}
            {@const isSelf = auth.user?.id === user.id}
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-premium duration-150">
              <td class="px-5 py-3.5">
                <div class="flex items-center gap-3.5">
                  {#if user.avatar}
                    <img src={user.avatar} alt={user.name} class="w-9 h-9 rounded-xl object-cover bg-indigo-50 border border-slate-200/50" />
                  {:else}
                    <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shadow-sm">
                      {initials(user)}
                    </div>
                  {/if}
                  <div class="min-w-0">
                    <div class="font-bold text-slate-900 dark:text-white truncate">{user.name}</div>
                    {#if isSelf}
                      <div class="text-[9px] text-emerald-500 font-bold uppercase tracking-wider mt-1 flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Akun Anda
                      </div>
                    {/if}
                  </div>
                </div>
              </td>
              <td class="px-5 py-3.5 font-mono-data text-xs text-slate-600 dark:text-slate-300 font-semibold">{user.username}</td>
              <td class="px-5 py-3.5">
                <span class="inline-flex px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  {ROLE_LABELS[user.role]}
                </span>
              </td>
              <td class="px-5 py-3.5">
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onclick={() => navigate(`/user-management/${user.id}/edit`)}
                    class="p-2 border border-[var(--border)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] rounded-xl transition-premium shadow-sm text-slate-500 dark:text-slate-400"
                    title="Edit user"
                  >
                    <Edit3 class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={isSelf}
                    onclick={() => remove(user)}
                    class="p-2 border border-rose-500/10 hover:bg-rose-500/10 rounded-xl transition-premium text-rose-500 disabled:opacity-40 disabled:pointer-events-none shadow-sm"
                    title={isSelf ? 'Tidak bisa menghapus akun sendiri' : 'Hapus user'}
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          {/each}

          {#if !users.loading && filtered.length === 0}
            <tr>
              <td colspan="4" class="px-5 py-16 text-center text-[var(--muted-foreground)] font-medium">
                Tidak ditemukan user terdaftar yang cocok dengan filter pencarian.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
