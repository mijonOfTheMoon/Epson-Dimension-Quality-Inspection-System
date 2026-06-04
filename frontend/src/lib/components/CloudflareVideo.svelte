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
  let prevStationId = '';
  let prevOnline = false;
  let prevRunning = false;

  const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const videoReadyRetryMs = 1500;
  const videoReadyTimeoutMs = 20000;
  /** Max retry attempts for stale-session / transient errors before giving up */
  const maxSessionRetries = 3;

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      const timeout = window.setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });

  const isVideoPendingError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status !== 404 && error.status !== 503) return false;
    return (
      error.message.includes('Video agent belum tersedia') ||
      error.message.includes('Track video agent belum tersedia') ||
      error.message.includes('Agent offline') ||
      error.message.includes('Presence agent tidak ditemukan')
    );
  };

  /** Returns true for errors that indicate stale/expired Cloudflare session */
  const isStaleSessionError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return false;
    const msg = error.message.toLowerCase();
    if (msg.includes('cloudflare') && (msg.includes('gagal') || msg.includes('failed'))) return true;
    if (error.status === 500) return true;
    return false;
  };

  const isPeerClosedError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return msg.includes('closed') && (msg.includes('peer') || msg.includes('connection'));
  };

  const waitForIceGathering = (peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 3000) => {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(done, timeoutMs);
      function done() {
        window.clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        onAbort && signal.removeEventListener('abort', onAbort);
        resolve();
      }
      function onStateChange() {
        if (peer.iceGatheringState === 'complete') done();
      }
      const onAbort = () => done();
      peer.addEventListener('icegatheringstatechange', onStateChange);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const waitForPeerConnection = (peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 12000) => {
    const connected = () =>
      peer.connectionState === 'connected' ||
      peer.iceConnectionState === 'connected' ||
      peer.iceConnectionState === 'completed';
    const closed = () =>
      peer.connectionState === 'closed' ||
      peer.iceConnectionState === 'closed';
    if (connected()) return Promise.resolve();
    if (closed()) return Promise.reject(new Error('PeerConnection sudah ditutup'));
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => done(new Error('Cloudflare Realtime belum tersambung')),
        timeoutMs,
      );
      function done(error?: Error) {
        window.clearTimeout(timeout);
        peer.removeEventListener('connectionstatechange', onStateChange);
        peer.removeEventListener('iceconnectionstatechange', onStateChange);
        onAbort && signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      }
      function onStateChange() {
        if (connected()) done();
        else if (
          peer.connectionState === 'failed' || peer.iceConnectionState === 'failed'
        ) {
          done(new Error('Cloudflare Realtime gagal tersambung'));
        } else if (closed()) {
          done(new Error('PeerConnection sudah ditutup'));
        }
      }
      const onAbort = () => done(new Error('Koneksi dibatalkan'));
      peer.addEventListener('connectionstatechange', onStateChange);
      peer.addEventListener('iceconnectionstatechange', onStateChange);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const closePeer = () => {
    if (pc) {
      try { pc.close(); } catch { /* already closed */ }
      pc = null;
    }
    if (videoEl) videoEl.srcObject = null;
  };

  const connectOnce = async (targetStationId: string, signal: AbortSignal) => {
    closePeer();

    const peer = new RTCPeerConnection({ iceServers: defaultIceServers });
    peer.ontrack = (event) => {
      if (!videoEl) return;
      videoEl.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    };
    peer.addTransceiver('video', { direction: 'recvonly' });
    pc = peer;

    if (signal.aborted) { closePeer(); return; }

    const initialOffer = await peer.createOffer();
    await peer.setLocalDescription(initialOffer);
    await waitForIceGathering(peer, signal);
    if (signal.aborted) { closePeer(); return; }
    if (!peer.localDescription) throw new Error('Gagal membuat offer WebRTC');

    const session = await api.createVideoViewerSession(targetStationId, {
      sdp: peer.localDescription.sdp,
      type: peer.localDescription.type,
    });
    if (signal.aborted) { closePeer(); return; }
    if (!session.sessionDescription) {
      throw new Error('Cloudflare belum mengirim jawaban session video');
    }
    await peer.setRemoteDescription(session.sessionDescription);
    await waitForPeerConnection(peer, signal);
    if (signal.aborted) { closePeer(); return; }

    const pull = await api.pullVideoTrack(
      session.viewerSessionId,
      session.publisherSessionId,
      session.trackName,
    );
    if (signal.aborted) { closePeer(); return; }
    if (pull.requiresImmediateRenegotiation && !pull.sessionDescription) {
      throw new Error('Cloudflare meminta renegosiasi tanpa offer video');
    }
    if (pull.sessionDescription) {
      await peer.setRemoteDescription(pull.sessionDescription);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer, signal);
      if (signal.aborted) { closePeer(); return; }
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
    signal: AbortSignal,
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
    let sessionRetries = 0;
    try {
      while (!signal.aborted) {
        try {
          await connectOnce(targetStationId, signal);
          if (!signal.aborted) message = '';
          return;
        } catch (err) {
          closePeer();
          if (signal.aborted) return;

          if (isPeerClosedError(err)) {
            return;
          }

          if (isVideoPendingError(err) && Date.now() < deadline) {
            message = 'Menunggu video agent...';
            await sleep(videoReadyRetryMs, signal);
            continue;
          }

          if (isStaleSessionError(err) && sessionRetries < maxSessionRetries) {
            sessionRetries++;
            message = `Sesi expired, mencoba ulang (${sessionRetries}/${maxSessionRetries})...`;
            await sleep(1000 * (2 ** (sessionRetries - 1)), signal);
            continue;
          }

          if (!signal.aborted) message = getErrorMessage(err);
          return;
        }
      }
    } finally {
      if (!signal.aborted) connecting = false;
    }
  };

  let activeController: AbortController | null = null;

  const startConnection = (sid: string, on: boolean, run: boolean) => {
    if (activeController) {
      activeController.abort();
      untrack(closePeer);
    }
    const controller = new AbortController();
    activeController = controller;
    void connect(sid, on, run, controller.signal);
  };

  $effect(() => {
    const sid = stationId;
    const on = online;
    const run = running;

    if (sid === prevStationId && on === prevOnline && run === prevRunning) {
      return;
    }
    prevStationId = sid;
    prevOnline = on;
    prevRunning = run;

    untrack(() => startConnection(sid, on, run));
  });

  $effect(() => {
    return () => {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
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
