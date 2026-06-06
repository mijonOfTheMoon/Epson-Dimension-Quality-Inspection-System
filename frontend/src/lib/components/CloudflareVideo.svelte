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
  let pendingStream = $state<MediaStream | null>(null);
  let prevStationId = '';
  let prevOnline = false;
  let prevRunning = false;

  const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const videoReadyRetryMs = 500;
  const videoReadyTimeoutMs = 20000;
  const videoUnavailableText = 'Stream video agent belum tersedia';
  const videoEndpointUnreachableText = 'Endpoint video tidak ditemukan — periksa koneksi/server';
  const maxSessionRetries = 3;
  const backgroundRetryBaseMs = 5000;
  const backgroundRetryMaxMs = 30000;

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      const onAbort = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
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

  const isStaleSessionError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return false;
    const msg = error.message.toLowerCase();
    if (msg.includes('cloudflare') && (msg.includes('gagal') || msg.includes('failed'))) return true;
    if (error.status === 500) return true;
    return false;
  };

  const isRoutingError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) return false;
    if (error.status !== 404) return false;
    if (isVideoPendingError(error)) return false;
    return error.hasJsonBody === false;
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

  const waitForPeerDisconnect = (peer: RTCPeerConnection, signal: AbortSignal) => {
    const isTerminal = () =>
      peer.connectionState === 'failed' ||
      peer.connectionState === 'closed';
    if (isTerminal()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let disconnectTimeout: number | undefined;
      function cleanup() {
        if (disconnectTimeout != null) { window.clearTimeout(disconnectTimeout); disconnectTimeout = undefined; }
        peer.removeEventListener('connectionstatechange', onState);
        peer.removeEventListener('iceconnectionstatechange', onState);
        signal.removeEventListener('abort', onAbort);
      }
      function done() { cleanup(); resolve(); }
      function onState() {
        if (isTerminal()) { done(); return; }
        if (peer.connectionState === 'disconnected' || peer.iceConnectionState === 'disconnected') {
          if (disconnectTimeout == null) {
            disconnectTimeout = window.setTimeout(done, 5000);
          }
        } else if (disconnectTimeout != null) {
          window.clearTimeout(disconnectTimeout);
          disconnectTimeout = undefined;
        }
      }
      function onAbort() { done(); }
      peer.addEventListener('connectionstatechange', onState);
      peer.addEventListener('iceconnectionstatechange', onState);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  const teardownPeer = (peer: RTCPeerConnection | null) => {
    if (peer) {
      try { peer.close(); } catch { }
    }
    if (peer === null || pc === peer) {
      pc = null;
      pendingStream = null;
      if (videoEl) videoEl.srcObject = null;
    }
  };

  const closePeer = () => {
    teardownPeer(pc);
  };

  const connectOnce = async (
    targetStationId: string,
    signal: AbortSignal,
    register: (peer: RTCPeerConnection) => void,
  ) => {
    closePeer();

    const peer = new RTCPeerConnection({
      iceServers: defaultIceServers,
      bundlePolicy: 'max-bundle',
    });

    peer.ontrack = (event) => {
      if (pc !== peer) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      pendingStream = stream;
      if (videoEl) videoEl.srcObject = stream;
    };

    peer.addTransceiver('video', { direction: 'recvonly' });
    pc = peer;
    register(peer);

    if (signal.aborted) { teardownPeer(peer); return; }

    const initialOffer = await peer.createOffer();
    await peer.setLocalDescription(initialOffer);
    await waitForIceGathering(peer, signal);
    if (signal.aborted) { teardownPeer(peer); return; }
    if (!peer.localDescription) throw new Error('Gagal membuat offer WebRTC');

    const session = await api.createVideoViewerSession(targetStationId, {
      sdp: peer.localDescription.sdp,
      type: peer.localDescription.type,
    });
    if (signal.aborted) { teardownPeer(peer); return; }
    if (!session.sessionDescription) {
      throw new Error('Cloudflare belum mengirim jawaban session video');
    }
    await peer.setRemoteDescription(
      new RTCSessionDescription(session.sessionDescription),
    );
    if (signal.aborted) { teardownPeer(peer); return; }

    const pull = await api.pullVideoTrack(
      session.viewerSessionId,
      session.publisherSessionId,
      session.trackName,
    );
    if (signal.aborted) { teardownPeer(peer); return; }
    if (pull.requiresImmediateRenegotiation && !pull.sessionDescription) {
      throw new Error('Cloudflare meminta renegosiasi tanpa offer video');
    }
    if (pull.sessionDescription) {
      await peer.setRemoteDescription(
        new RTCSessionDescription(pull.sessionDescription),
      );
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer, signal);
      if (signal.aborted) { teardownPeer(peer); return; }
      if (!peer.localDescription) throw new Error('Gagal membuat jawaban WebRTC');
      await api.renegotiateVideoSession(session.renegotiatePath, {
        sdp: peer.localDescription.sdp,
        type: peer.localDescription.type,
      });
    }
    if (signal.aborted) { teardownPeer(peer); return; }
    await waitForPeerConnection(peer, signal);
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
    let backgroundRetryDelay = backgroundRetryBaseMs;
    let sessionPeer: RTCPeerConnection | null = null;

    try {
      while (!signal.aborted) {
        const deadline = Date.now() + videoReadyTimeoutMs;
        let sessionRetries = 0;
        let connected = false;

        while (!signal.aborted) {
          try {
            await connectOnce(targetStationId, signal, (peer) => { sessionPeer = peer; });
            if (!signal.aborted) {
              message = '';
              backgroundRetryDelay = backgroundRetryBaseMs;
              connected = true;
            }
            break;
          } catch (err) {
            teardownPeer(sessionPeer);
            sessionPeer = null;
            if (signal.aborted) return;
            if (isPeerClosedError(err)) return;

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

            if (!signal.aborted) {
              if (isRoutingError(err)) {
                message = videoEndpointUnreachableText;
              } else if (isVideoPendingError(err) && Date.now() >= deadline) {
                message = videoUnavailableText;
              } else {
                message = getErrorMessage(err);
              }
              connecting = false;
            }
            break;
          }
        }

        if (signal.aborted) return;

        if (connected && sessionPeer) {
          connecting = false;
          await waitForPeerDisconnect(sessionPeer, signal);
          if (signal.aborted) return;

          teardownPeer(sessionPeer);
          sessionPeer = null;
          message = 'Koneksi terputus, menghubungkan ulang...';
          connecting = true;
          await sleep(1000, signal);
          if (signal.aborted) return;
          continue;
        }

        await sleep(backgroundRetryDelay, signal);
        if (signal.aborted) return;
        backgroundRetryDelay = Math.min(
          Math.round(backgroundRetryDelay * 1.5),
          backgroundRetryMaxMs,
        );
        message = 'Mencoba menghubungkan ulang...';
      }
    } finally {
      if (!signal.aborted) connecting = false;
    }
  };

  $effect(() => {
    if (videoEl && pendingStream) {
      videoEl.srcObject = pendingStream;
    }
  });

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
