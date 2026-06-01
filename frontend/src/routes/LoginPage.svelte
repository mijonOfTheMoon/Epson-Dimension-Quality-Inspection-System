<script lang="ts">
  import { navigate, useLocation } from 'svelte-routing';
  import { ScanLine, Eye, EyeOff, Lock, User } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { getErrorMessage } from '$lib/services/api';

  let username = $state('');
  let password = $state('');
  let showPw = $state(false);
  let error = $state('');
  let loading = $state(false);
  const location = useLocation();

  $effect(() => {
    if (auth.status === 'authenticated' && $location.pathname !== '/dashboard') {
      navigate('/dashboard', { replace: true });
    }
  });

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    loading = true;
    error = '';
    try {
      const ok = await auth.login(username, password);
      if (!ok) error = 'Username atau password salah';
    } catch (err) {
      error = getErrorMessage(err);
    } finally {
      loading = false;
    }
  };
</script>

<div class="min-h-screen flex items-center justify-center bg-[#070b14] relative overflow-hidden p-4 font-sans select-none">
  <!-- Glowing Background Orbs -->
  <div class="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[150px] pointer-events-none animate-pulse duration-5000"></div>
  <div class="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-violet-500/10 blur-[150px] pointer-events-none animate-pulse duration-7000"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] rounded-full bg-blue-500/5 blur-[200px] pointer-events-none"></div>

  <!-- Content Container -->
  <div class="w-full max-w-[440px] relative z-10 animate-in fade-in zoom-in-95 duration-500">
    <!-- Brand / Title -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-0.5 shadow-xl shadow-indigo-500/10 mb-4 animate-bounce-slow">
        <div class="w-full h-full rounded-2xl bg-[#090d16] flex items-center justify-center">
          <ScanLine class="w-8 h-8 text-indigo-400" />
        </div>
      </div>
      <h1 class="text-white text-3xl font-extrabold tracking-tight">DimInspect</h1>
      <p class="text-slate-400 text-xs font-medium mt-2 tracking-wide uppercase">Inspection Dimension Monitoring System</p>
    </div>

    <!-- Login Card -->
    <form onsubmit={handleSubmit} class="bg-[#0f172a]/55 border border-slate-800/80 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl relative">
      <div class="absolute -top-[1px] left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
      
      <h2 class="text-xl font-bold text-center text-white mb-6">Masuk ke Sistem</h2>

      {#if error}
        <div class="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl mb-5 flex items-center gap-2 animate-in fade-in duration-200">
          <span class="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
          <span>{error}</span>
        </div>
      {/if}

      <div class="space-y-4">
        <!-- Username Input -->
        <div>
          <label class="text-[11px] font-semibold text-slate-400 mb-1.5 block tracking-wider uppercase" for="login-username">Username</label>
          <div class="relative">
            <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              <User class="w-[17px] h-[17px]" />
            </div>
            <input
              id="login-username"
              bind:value={username}
              class="w-full pl-10 pr-4 py-3 border border-slate-800 bg-[#070b14]/50 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-premium"
              placeholder="Masukkan username"
              autocomplete="username"
              required
            />
          </div>
        </div>

        <!-- Password Input -->
        <div>
          <label class="text-[11px] font-semibold text-slate-400 mb-1.5 block tracking-wider uppercase" for="login-password">Password</label>
          <div class="relative">
            <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
              <Lock class="w-[17px] h-[17px]" />
            </div>
            <input
              id="login-password"
              type={showPw ? 'text' : 'password'}
              bind:value={password}
              class="w-full pl-10 pr-10 py-3 border border-slate-800 bg-[#070b14]/50 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-premium"
              placeholder="Masukkan password"
              autocomplete="current-password"
              required
            />
            <button type="button" onclick={() => showPw = !showPw} class="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
              {#if showPw}
                <EyeOff class="w-[17px] h-[17px]" />
              {:else}
                <Eye class="w-[17px] h-[17px]" />
              {/if}
            </button>
          </div>
        </div>
      </div>

      <!-- Submit Button -->
      <button 
        disabled={loading} 
        type="submit" 
        class="w-full mt-7 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-indigo-500/15 active:scale-[0.98] transition-premium disabled:opacity-60 disabled:pointer-events-none"
      >
        {#if loading}
          <div class="flex items-center justify-center gap-2">
            <span class="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></span>
            <span>Memproses...</span>
          </div>
        {:else}
          <span>Masuk</span>
        {/if}
      </button>
    </form>
    
    <!-- Footer Credits -->
    <div class="text-center mt-8 text-slate-500 text-xs">
      &copy; {new Date().getFullYear()} DimInspect. All rights reserved.
    </div>
  </div>
</div>

<style>
  :global(.animate-bounce-slow) {
    animation: bounce 3s infinite;
  }
  @keyframes bounce {
    0%, 100% {
      transform: translateY(-5%);
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: translateY(0);
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
  }
</style>
