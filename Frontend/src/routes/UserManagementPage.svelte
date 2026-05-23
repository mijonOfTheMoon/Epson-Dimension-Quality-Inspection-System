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

<div class="space-y-5">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1>Manajemen User</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">Akun, role, dan akses pengguna.</p>
    </div>
    <button
      onclick={() => navigate('/user-management/new')}
      class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm self-start"
    >
      <Plus class="w-4 h-4" /> User baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if users.error}<Notice text={users.error} />{/if}

  {#if users.loading}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat data user dari backend...
    </div>
  {/if}

  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1">
      <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
      <input
        bind:value={search}
        class="w-full pl-10 pr-4 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]"
        placeholder="Cari nama, username, atau role..."
      />
    </div>
    <select bind:value={roleFilter} class="px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--card)]">
      <option value="">Semua Role</option>
      {#each ROLES as role (role)}
        <option value={role}>{ROLE_LABELS[role]}</option>
      {/each}
    </select>
  </div>

  <div class="text-sm text-[var(--muted-foreground)]">{filtered.length} user ditemukan</div>

  <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--accent)] text-left">
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Username</th>
            <th class="px-4 py-3">Role</th>
            <th class="px-4 py-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as user (user.id)}
            {@const isSelf = auth.user?.id === user.id}
            <tr class="border-t border-[var(--border)] hover:bg-[var(--accent)]/50">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  {#if user.avatar}
                    <img src={user.avatar} alt={user.name} class="w-9 h-9 rounded-full object-cover bg-blue-100" />
                  {:else}
                    <div class="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">
                      {initials(user)}
                    </div>
                  {/if}
                  <div class="min-w-0">
                    <div class="font-medium truncate">{user.name}</div>
                    {#if isSelf}
                      <div class="text-[11px] text-[var(--muted-foreground)]">Akun aktif</div>
                    {/if}
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 font-mono text-xs">{user.username}</td>
              <td class="px-4 py-3">
                <span class="inline-flex px-2.5 py-1 rounded-full bg-[var(--accent)] text-xs">
                  {ROLE_LABELS[user.role]}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onclick={() => navigate(`/user-management/${user.id}/edit`)}
                    class="p-1.5 rounded-md hover:bg-[var(--accent)]"
                    aria-label="Edit user"
                    title="Edit user"
                  >
                    <Edit3 class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={isSelf}
                    onclick={() => remove(user)}
                    class="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                    aria-label="Hapus user"
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
              <td colspan="4" class="px-4 py-12 text-center text-[var(--muted-foreground)]">
                Tidak ada user yang cocok.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
