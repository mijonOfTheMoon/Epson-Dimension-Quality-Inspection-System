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

<div class="space-y-6 select-none font-sans">
  <!-- Top Navigation Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <button onclick={() => navigate('/user-management')} class="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-2.5 transition-colors group">
        <ArrowLeft class="w-3.5 h-3.5 transition-transform group-hover:-translate-x-[2px]" /> Kembali
      </button>
      <h1 class="text-slate-900 dark:text-white tracking-tight">{isEdit ? 'Edit Akun Pengguna' : 'Tambah User Baru'}</h1>
      <p class="text-sm text-[var(--muted-foreground)] mt-1.5 font-medium">Atur profil, avatar, dan otorisasi keamanan personil sistem.</p>
    </div>
    <!-- Actions Buttons -->
    <div class="flex items-center gap-2 self-start sm:self-auto shrink-0">
      <button onclick={() => navigate('/user-management')} class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--card)] text-xs font-bold hover:bg-[var(--accent)] text-slate-700 dark:text-slate-300 transition-premium shadow-sm">
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
  {#if users.error}<Notice text={users.error} />{/if}

  {#if users.loading && isEdit}
    <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 text-xs font-bold text-[var(--muted-foreground)] shadow-sm animate-pulse flex items-center gap-2">
      <span class="w-4 h-4 rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] animate-spin"></span>
      <span>Memuat data user...</span>
    </div>
  {:else if notFound}
    <div class="bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 rounded-2xl p-4.5 text-sm font-semibold">
      Akun pengguna tidak ditemukan di database.
    </div>
  {:else}
    <!-- Form Segment: Profile -->
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-4">
      <h3 class="text-base font-bold text-slate-900 dark:text-white border-b border-[var(--border)] pb-2">Informasi Profil Personil</h3>
      <div class="grid md:grid-cols-2 gap-4">
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Nama Lengkap</span>
          <input bind:value={form.name} class="input text-slate-900 dark:text-white font-semibold" placeholder="Nama lengkap personil QC" required />
        </label>
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Username Kredensial</span>
          <input bind:value={form.username} class="input font-mono-data text-indigo-600 dark:text-indigo-400 font-bold" placeholder="username_qc" required />
        </label>
        <label class="space-y-1.5 text-xs font-bold text-slate-500 md:col-span-2">
          <span class="tracking-wide text-[10px] uppercase">Tautan Gambar Avatar (Opsional)</span>
          <input bind:value={form.avatar} class="input text-slate-900 dark:text-white font-semibold" placeholder="https://example.com/avatar.png" />
        </label>
      </div>
    </section>

    <!-- Form Segment: Access Control -->
    <section class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-4">
      <h3 class="text-base font-bold text-slate-900 dark:text-white border-b border-[var(--border)] pb-2">Akses &amp; Tingkat Keamanan</h3>
      <div class="grid md:grid-cols-2 gap-4">
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">Tingkat Hak Akses (Role)</span>
          <select bind:value={form.role} class="input font-semibold text-xs py-2.5">
            {#each ROLE_OPTIONS as role (role.value)}
              <option value={role.value}>{role.label}</option>
            {/each}
          </select>
        </label>
        <label class="space-y-1.5 text-xs font-bold text-slate-500">
          <span class="tracking-wide text-[10px] uppercase">
            {isEdit ? 'Kunci Keamanan Baru (Biarkan kosong jika tidak diganti)' : 'Kunci Keamanan (Password)'}
          </span>
          <input type="password" bind:value={form.password} class="input text-slate-900 dark:text-white font-semibold" placeholder="Min. 4 karakter" />
        </label>
      </div>
    </section>
  {/if}
</div>
