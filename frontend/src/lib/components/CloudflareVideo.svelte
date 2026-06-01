<script lang="ts">
  import { untrack } from 'svelte';
  import { Video } from 'lucide-svelte';
  import { api, getErrorMessage } from '$lib/services/api';

  interface Props {
    stationId: string;
    online: boolean;
    running: boolean;
  }

  let { stationId, online, running }: Props = $props();
  let videoEl = $state<HTMLVideoElement | null>(null);
  let pc: RTCPeerConnection | null = null;
  let message = $state('Kamera Siap - Konfigurasi lalu klik Mulai');
  let connecting = $state(false);

  const closePeer = () => {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (videoEl) videoEl.srcObject = null;
  };

  const connect = async (targetStationId: string, isOnline: boolean, isRunning: boolean) => {
    untrack(closePeer);
    if (!isOnline) {
      message = 'Agent Offline';
      return;
    }
    if (!isRunning) {
      message = 'Kamera Siap - Konfigurasi lalu klik Mulai';
      return;
    }
    connecting = true;
    message = 'Menghubungkan Cloudflare Realtime...';
    try {
      const session = await api.createVideoViewerSession(targetStationId);
      const peer = new RTCPeerConnection({ iceServers: session.iceServers });
      peer.ontrack = (event) => {
        if (!videoEl) return;
        videoEl.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      };
      pc = peer;
      if (!session.sessionDescription) {
        throw new Error('Cloudflare belum mengirim offer video');
      }
      await peer.setRemoteDescription(session.sessionDescription);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (!peer.localDescription) throw new Error('Gagal membuat jawaban WebRTC');
      await api.renegotiateVideoSession(session.renegotiatePath, {
        sdp: peer.localDescription.sdp,
        type: peer.localDescription.type,
      });
      message = '';
    } catch (err) {
      closePeer();
      message = getErrorMessage(err);
    } finally {
      connecting = false;
    }
  };

  $effect(() => {
    const targetStationId = stationId;
    const isOnline = online;
    const isRunning = running;
    void connect(targetStationId, isOnline, isRunning);
    return () => untrack(closePeer);
  });
</script>

{#if running && online && !message}
  <video
    bind:this={videoEl}
    autoplay
    playsinline
    muted
    class="w-full h-full object-contain"
  ></video>
{:else}
  <div class="text-slate-500 text-xs flex flex-col items-center select-none font-medium px-6 text-center">
    <Video class="w-10 h-10 mb-3 opacity-30 text-indigo-400" />
    <span>{connecting ? 'Menghubungkan Cloudflare Realtime...' : message}</span>
  </div>
{/if}
