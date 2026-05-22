<script lang="ts">
  import { Plus, Save, Trash2 } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { useUsers } from '$lib/hooks/useUsers.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { User, UserRole } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

  const ROLES: UserRole[] = ['operator', 'qc', 'supervisor', 'engineering', 'admin', 'vendor'];

  const emptyForm = () => ({
    username: '',
    password: '',
    name: '',
    role: 'operator' as UserRole,
    avatar: '',
  });

  const users = useUsers();

  let editingId = $state<string | null>(null);
  let form = $state(emptyForm());
  let saving = $state(false);
  let error = $state<string | null>(null);

  const edit = (user: User) => {
    editingId = user.id;
    form = {
      username: user.username,
      password: '',
      name: user.name,
      role: user.role,
      avatar: user.avatar ?? '',
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
      if (editingId) {
        await api.updateUser(editingId, {
          username: form.username,
          name: form.name,
          role: form.role,
          avatar: form.avatar || undefined,
          password: form.password || undefined,
        });
      } else {
        await api.createUser({
          username: form.username,
          password: form.password,
          name: form.name,
          role: form.role,
          avatar: form.avatar || undefined,
        });
      }
      users.reload();
      reset();
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      saving = false;
    }
  };

  const remove = async (user: User) => {
    if (!window.confirm(`Hapus user ${user.username}?`)) return;
    error = null;
    try {
      await api.deleteUser(user.id);
      users.reload();
      if (editingId === user.id) reset();
    } catch (err) {
      error = getErrorMessage(err);
    }
  };
</script>

<div class="space-y-5">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1>Manajemen User</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">Kelola akun dan role pengguna.</p>
    </div>
    <button onclick={reset} class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]">
      <Plus class="w-4 h-4" /> User baru
    </button>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if users.error}<Notice text={users.error} />{/if}

  <div class="grid xl:grid-cols-[380px_1fr] gap-4">
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div class="p-4 border-b border-[var(--border)]">
        <h3 class="text-sm">Daftar User</h3>
      </div>
      <div class="divide-y divide-[var(--border)]">
        {#each users.data as user (user.id)}
          <div class="p-4 flex items-start justify-between gap-3 {editingId === user.id ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}">
            <button onclick={() => edit(user)} class="text-left min-w-0">
              <div class="font-medium truncate">{user.name}</div>
              <div class="text-xs text-[var(--muted-foreground)] truncate">{user.username} - {user.role}</div>
            </button>
            <button
              disabled={auth.user?.id === user.id}
              onclick={() => remove(user)}
              class="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
              aria-label="Hapus user"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        {/each}
        {#if !users.loading && users.data.length === 0}
          <div class="p-8 text-center text-sm text-[var(--muted-foreground)]">Belum ada user.</div>
        {/if}
      </div>
    </section>

    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
      <div class="grid md:grid-cols-2 gap-3">
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Nama</span>
          <input bind:value={form.name} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Username</span>
          <input bind:value={form.username} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">{editingId ? 'Password baru (opsional)' : 'Password'}</span>
          <input type="password" bind:value={form.password} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Role</span>
          <select bind:value={form.role} class="input">
            {#each ROLES as role (role)}
              <option value={role}>{role}</option>
            {/each}
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Avatar URL (opsional)</span>
          <input bind:value={form.avatar} class="input" />
        </label>
      </div>
      <button disabled={saving} onclick={save} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
        <Save class="w-4 h-4" /> {editingId ? 'Simpan perubahan' : 'Buat user'}
      </button>
    </section>
  </div>
</div>
