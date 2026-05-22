<script lang="ts">
  import { navigate } from 'svelte-routing';
  import { ScanLine, Eye, EyeOff } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { getErrorMessage } from '$lib/services/api';

  let username = $state('');
  let password = $state('');
  let showPw = $state(false);
  let error = $state('');
  let loading = $state(false);

  $effect(() => {
    if (auth.status === 'authenticated') {
      navigate('/dashboard', { replace: true });
    }
  });

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    loading = true;
    error = '';
    try {
      const ok = await auth.login(username, password);
      if (ok) navigate('/dashboard', { replace: true });
      else error = 'Username atau password salah';
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      loading = false;
    }
  };
</script>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] p-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500 mb-4">
        <ScanLine class="w-8 h-8 text-white" />
      </div>
      <h1 class="text-white text-2xl">DimInspect</h1>
      <p class="text-gray-400 text-sm mt-1">Sistem Monitoring Kualitas Inspeksi Dimensi</p>
    </div>

    <form onsubmit={handleSubmit} class="bg-white rounded-2xl p-8 shadow-2xl">
      <h2 class="text-center mb-6 text-gray-900">Masuk ke Sistem</h2>

      {#if error}
        <div class="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>
      {/if}

      <div class="space-y-4">
        <div>
          <label class="text-sm text-gray-600 mb-1 block" for="login-username">Username</label>
          <input
            id="login-username"
            bind:value={username}
            class="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Masukkan username"
            autocomplete="username"
          />
        </div>
        <div>
          <label class="text-sm text-gray-600 mb-1 block" for="login-password">Password</label>
          <div class="relative">
            <input
              id="login-password"
              type={showPw ? 'text' : 'password'}
              bind:value={password}
              class="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
              placeholder="Masukkan password"
              autocomplete="current-password"
            />
            <button type="button" onclick={() => showPw = !showPw} class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {#if showPw}
                <EyeOff class="w-4 h-4" />
              {:else}
                <Eye class="w-4 h-4" />
              {/if}
            </button>
          </div>
        </div>
      </div>

      <button disabled={loading} type="submit" class="w-full mt-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60">
        {loading ? 'Memproses...' : 'Masuk'}
      </button>
    </form>
  </div>
</div>
