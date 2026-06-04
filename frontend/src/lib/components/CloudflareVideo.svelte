<script lang="ts">
  import { untrack } from 'svelte';
  import { Video } from 'lucide-svelte';
  import { ApiRequestError, api, getErrorMessage } from '$lib/services/api';

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

  const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const videoReadyRetryMs = 1000;
  const videoReadyTimeoutMs = 20000;

  const sleep = (ms: number, isCancelled: () => boolean) =>
    new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, ms);
      if (isCancelled()) {
        window.clearTimeout(timeout);
        resolve();
      }
    });

  const isVideoPendingError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status !== 404 && error.status !== 503) return false;
    return (
      error.message.includes('Video agent belum tersedia') ||
      error.message.includes('Track video agent belum tersedia')
    );
  };

  const waitForIceGathering = (peer: RTCPeerConnection, timeoutMs = 3000) => {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(done, timeoutMs);
      function done() {
        window.clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
      function onStateChange() {
        if (peer.iceGatheringState === 'complete') done();
      }
      peer.addEventListener('icegatheringstatechange', onStateChange);
    });
  };

  const waitForPeerConnection = (peer: RTCPeerConnection, timeoutMs = 12000) => {
    const connected = () =>
      peer.connectionState === 'connected' ||
      peer.iceConnectionState === 'connected' ||
      peer.iceConnectionState === 'completed';
    if (connected()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => done(new Error('Cloudflare Realtime belum tersambung')),
        timeoutMs,
      );
      function done(error?: Error) {
        window.clearTimeout(timeout);
        peer.removeEventListener('connectionstatechange', onStateChange);
        peer.removeEventListener('iceconnectionstatechange', onStateChange);
        if (error) reject(error);
        else resolve();
      }
      function onStateChange() {
        if (connected()) done();
        else if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') {
          done(new Error('Cloudflare Realtime gagal tersambung'));
        }
      }
      peer.addEventListener('connectionstatechange', onStateChange);
      peer.addEventListener('iceconnectionstatechange', onStateChange);
    });
  };

  const closePeer = () => {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (videoEl) videoEl.srcObject = null;
  };

  const connectOnce = async (targetStationId: string) => {
    const peer = new RTCPeerConnection({ iceServers: defaultIceServers });
    peer.ontrack = (event) => {
      if (!videoEl) return;
      videoEl.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    };
    peer.addTransceiver('video', { direction: 'recvonly' });
    pc = peer;

    const initialOffer = await peer.createOffer();
    await peer.setLocalDescription(initialOffer);
    await waitForIceGathering(peer);
    if (!peer.localDescription) throw new Error('Gagal membuat offer WebRTC');
    const session = await api.createVideoViewerSession(targetStationId, {
      sdp: peer.localDescription.sdp,
      type: peer.localDescription.type,
    });
    if (!session.sessionDescription) {
      throw new Error('Cloudflare belum mengirim jawaban session video');
    }
    await peer.setRemoteDescription(session.sessionDescription);
    await waitForPeerConnection(peer);

    const pull = await api.pullVideoTrack(
      session.viewerSessionId,
      session.publisherSessionId,
      session.trackName,
    );
    if (pull.requiresImmediateRenegotiation && !pull.sessionDescription) {
      throw new Error('Cloudflare meminta renegosiasi tanpa offer video');
    }
    if (pull.sessionDescription) {
      await peer.setRemoteDescription(pull.sessionDescription);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      if (!peer.localDescription) throw new Error('Gagal membuat jawaban WebRTC');
      await api.renegotiateVideoSession(session.renegotiatePath, {
        sdp: peer.localDescription.sdp,
        type: peer.localDescription.type,
      });
    }
  };

  const connect = async (
    targetStationId: string,
    isOnline: boolean,
    isRunning: boolean,
    isCancelled: () => boolean,
  ) => {
    untrack(closePeer);
    if (!isOnline) {
      connecting = false;
      message = 'Agent Offline';
      return;
    }
    if (!isRunning) {
      connecting = false;
      message = 'Kamera Siap - Konfigurasi lalu klik Mulai';
      return;
    }
    connecting = true;
    message = 'Menghubungkan Cloudflare Realtime...';
    const deadline = Date.now() + videoReadyTimeoutMs;
    try {
      while (!isCancelled()) {
        try {
          await connectOnce(targetStationId);
          if (!isCancelled()) message = '';
          return;
        } catch (err) {
          closePeer();
          if (isVideoPendingError(err) && Date.now() < deadline && !isCancelled()) {
            message = 'Menunggu video agent...';
            await sleep(videoReadyRetryMs, isCancelled);
            continue;
          }
          if (!isCancelled()) message = getErrorMessage(err);
          return;
        }
      }
    } finally {
      if (!isCancelled()) connecting = false;
    }
  };

  $effect(() => {
    const targetStationId = stationId;
    const isOnline = online;
    const isRunning = running;
    let cancelled = false;
    void connect(targetStationId, isOnline, isRunning, () => cancelled);
    return () => {
      cancelled = true;
      untrack(closePeer);
    };
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
