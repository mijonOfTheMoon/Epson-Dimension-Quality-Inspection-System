<script lang="ts">
  import { ArrowLeft, Save, X } from 'lucide-svelte';
  import { navigate } from 'svelte-routing';
  import { useUsers } from '$lib/hooks/useUsers.svelte';
  import { api, getErrorMessage } from '$lib/services/api';
  import type { User, UserRole } from '$lib/types/api';
  import Notice from '$lib/components/Notice.svelte';

  let { id }: { id?: string } = $props();

  interface UserDraft {
    name: string;
    username: string;
    password: string;
    role: UserRole;
    avatar: string;
  }

  const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
    { value: 'operator', label: 'Operator QC' },
    { value: 'qc', label: 'Quality Control' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'engineering', label: 'Engineering' },
    { value: 'admin', label: 'Admin Sistem' },
    { value: 'vendor', label: 'Vendor' },
  ];

  const users = useUsers();
  const isEdit = $derived(Boolean(id));

  let form = $state<UserDraft>(emptyForm());
  let saving = $state(false);
  let error = $state<string | null>(null);
  let initializedFor = $state<string | null>(null);
  let notFound = $state(false);

  function emptyForm(): UserDraft {
    return {
      name: '',
      username: '',
      password: '',
      role: 'operator',
      avatar: '',
    };
  }

  function formFromUser(user: User): UserDraft {
    return {
      name: user.name,
      username: user.username,
      password: '',
      role: user.role,
      avatar: user.avatar ?? '',
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
    if (users.loading) return;
    const user = users.data.find((item) => item.id === id);
    if (!user) {
      notFound = true;
      initializedFor = key;
      return;
    }
    form = formFromUser(user);
    initializedFor = key;
  });

  const validate = () => {
    if (!form.name.trim()) return 'Nama wajib diisi.';
    if (!form.username.trim()) return 'Username wajib diisi.';
    if (!id && form.password.length < 4) return 'Password minimal 4 karakter.';
    if (id && form.password && form.password.length < 4) return 'Password baru minimal 4 karakter.';
    return null;
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      error = validation;
      return;
    }

    saving = true;
    error = null;
    try {
      const base = {
        username: form.username.trim(),
        name: form.name.trim(),
        role: form.role,
        avatar: form.avatar.trim() || undefined,
      };
      if (id) {
        await api.updateUser(id, {
          ...base,
          password: form.password || undefined,
        });
      } else {
        await api.createUser({
          ...base,
          password: form.password,
        });
      }
      navigate('/user-management');
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
      <button onclick={() => navigate('/user-management')} class="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2">
        <ArrowLeft class="w-4 h-4" /> Back
      </button>
      <h1>{isEdit ? 'Edit User' : 'Tambah User'}</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1">Profil dan akses pengguna sistem.</p>
    </div>
    <div class="flex items-center gap-2">
      <button onclick={() => navigate('/user-management')} class="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]">
        <X class="w-4 h-4" /> Batal
      </button>
      <button disabled={saving || notFound} onclick={save} class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
        <Save class="w-4 h-4" /> Simpan
      </button>
    </div>
  </div>

  {#if error}<Notice text={error} />{/if}
  {#if users.error}<Notice text={users.error} />{/if}

  {#if users.loading && isEdit}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
      Memuat data user...
    </div>
  {:else if notFound}
    <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
      User tidak ditemukan.
    </div>
  {:else}
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
      <h3 class="text-sm">Profil</h3>
      <div class="grid md:grid-cols-2 gap-3">
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Nama</span>
          <input bind:value={form.name} class="input" />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Username</span>
          <input bind:value={form.username} class="input" />
        </label>
        <label class="space-y-1 text-sm md:col-span-2">
          <span class="text-xs text-[var(--muted-foreground)]">Avatar URL (opsional)</span>
          <input bind:value={form.avatar} class="input" />
        </label>
      </div>
    </section>

    <section class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
      <h3 class="text-sm">Akses</h3>
      <div class="grid md:grid-cols-2 gap-3">
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">Role</span>
          <select bind:value={form.role} class="input">
            {#each ROLE_OPTIONS as role (role.value)}
              <option value={role.value}>{role.label}</option>
            {/each}
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-xs text-[var(--muted-foreground)]">
            {isEdit ? 'Password baru (kosongkan jika tidak diganti)' : 'Password'}
          </span>
          <input type="password" bind:value={form.password} class="input" />
        </label>
      </div>
    </section>
  {/if}
</div>
