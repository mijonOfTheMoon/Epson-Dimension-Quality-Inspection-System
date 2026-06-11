<script lang="ts">
  import { untrack } from 'svelte';
  import { Video } from 'lucide-svelte';
  import { videoWatchSocketUrl } from '$lib/services/api';

  interface Props {
    stationId: string;
    online: boolean;
    running: boolean;
    onPlayingChange?: (playing: boolean) => void;
  }

  let { stationId, online, running, onPlayingChange }: Props = $props();

  let imgEl = $state<HTMLImageElement | null>(null);
  let message = $state('Kamera Siap - Konfigurasi lalu klik Mulai');
  let playing = $state(false);
  let socket: WebSocket | null = null;
  let objectUrl: string | null = null;
  let reconnectTimer: number | null = null;
  let closedByUs = false;

  let prevStationId = '';
  let prevOnline = false;
  let prevRunning = false;

  const reconnectDelayMs = 2000;

  const setPlaying = (value: boolean) => {
    if (playing === value) return;
    playing = value;
    onPlayingChange?.(value);
  };

  const clearReconnect = () => {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const releaseFrame = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const teardown = () => {
    closedByUs = true;
    clearReconnect();
    if (socket) {
      try { socket.close(); } catch { }
      socket = null;
    }
    releaseFrame();
    if (imgEl) imgEl.removeAttribute('src');
    setPlaying(false);
  };

  const renderFrame = (blob: Blob) => {
    const next = URL.createObjectURL(blob);
    const previous = objectUrl;
    objectUrl = next;
    if (imgEl) imgEl.src = next;
    if (previous) URL.revokeObjectURL(previous);
    message = '';
    setPlaying(true);
  };

  const connect = (sid: string, on: boolean, run: boolean) => {
    teardown();
    closedByUs = false;
    if (!on) { message = 'Agent Offline'; return; }
    if (!run) { message = 'Kamera Siap - Konfigurasi lalu klik Mulai'; return; }

    message = 'Menghubungkan stream...';
    const ws = new WebSocket(videoWatchSocketUrl(sid));
    ws.binaryType = 'blob';
    socket = ws;

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) renderFrame(event.data);
    };
    ws.onclose = () => {
      if (closedByUs) return;
      socket = null;
      setPlaying(false);
      message = 'Koneksi terputus, menghubungkan ulang...';
      clearReconnect();
      reconnectTimer = window.setTimeout(() => connect(sid, on, run), reconnectDelayMs);
    };
  };

  $effect(() => {
    const sid = stationId;
    const on = online;
    const run = running;
    if (sid === prevStationId && on === prevOnline && run === prevRunning) return;
    prevStationId = sid;
    prevOnline = on;
    prevRunning = run;
    untrack(() => connect(sid, on, run));
  });

  $effect(() => {
    return () => { untrack(teardown); };
  });
</script>

{#if running && online && !message}
  <img
    bind:this={imgEl}
    alt={`Live stream ${stationId}`}
    class="w-full h-full object-contain"
  />
{:else}
  <div class="text-slate-500 text-xs flex flex-col items-center select-none font-medium px-6 text-center">
    <Video class="w-10 h-10 mb-3 opacity-30 text-indigo-400" />
    <span>{message}</span>
  </div>
{/if}
