import { ApiRequestError, getErrorMessage } from './api';

export const CONNECTING_TEXT = 'Menghubungkan Cloudflare Realtime...';
export const PENDING_TEXT = 'Menunggu video agent...';
export const BACKGROUND_RETRY_TEXT = 'Mencoba menghubungkan ulang...';
export const AGENT_OFFLINE_TEXT = 'Agent Offline';
export const NOT_RUNNING_TEXT = 'Kamera Siap - Konfigurasi lalu klik Mulai';
export const GENERIC_404_MESSAGE = 'Request gagal (404)';
export const VIDEO_UNAVAILABLE_TEXT = 'Stream video agent belum tersedia';
export const VIDEO_ENDPOINT_UNREACHABLE_TEXT =
  'Endpoint video tidak ditemukan — periksa koneksi/server';

export const videoReadyTimeoutMs = 20000;
export const videoReadyRetryMs = 500;

export function isVideoPendingError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status !== 404 && error.status !== 503) return false;
  return (
    error.message.includes('Video agent belum tersedia') ||
    error.message.includes('Track video agent belum tersedia') ||
    error.message.includes('Agent offline') ||
    error.message.includes('Presence agent tidak ditemukan')
  );
}

export function isStaleSessionError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  const msg = error.message.toLowerCase();
  if (msg.includes('cloudflare') && (msg.includes('gagal') || msg.includes('failed'))) return true;
  if (error.status === 500) return true;
  return false;
}

export function isRoutingError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status !== 404) return false;
  if (isVideoPendingError(error)) return false;
  return error.hasJsonBody === false;
}

export function isWithinPendingWindow(now: number, deadline: number): boolean {
  return now < deadline;
}

export function placeholderText(connecting: boolean, message: string): string {
  return connecting ? CONNECTING_TEXT : message;
}

export interface SimulateOptions {
  online: boolean;
  running: boolean;
  sessionError?: ApiRequestError;
  startTime?: number;
}

export interface SimulateResult {
  connecting: boolean;
  message: string;
  displayedText: string;
  videoRendered: boolean;
  reachedDeadline: boolean;
}

const MAX_ITERATIONS = 1000;

export function simulateConnectLoop(opts: SimulateOptions): SimulateResult {
  const { online, running } = opts;
  const start = opts.startTime ?? 0;

  if (!online) {
    return finalize(false, AGENT_OFFLINE_TEXT, running, online, false);
  }
  if (!running) {
    return finalize(false, NOT_RUNNING_TEXT, running, online, false);
  }

  let connecting = true;
  let message = CONNECTING_TEXT;

  if (!opts.sessionError) {
    message = '';
    connecting = false;
    return finalize(connecting, message, running, online, false);
  }

  const err = opts.sessionError;
  const deadline = start + videoReadyTimeoutMs;
  let now = start;
  let reachedDeadline = false;
  let iterations = 0;

  while (iterations++ < MAX_ITERATIONS) {
    if (isVideoPendingError(err) && isWithinPendingWindow(now, deadline)) {
      message = PENDING_TEXT;
      now += videoReadyRetryMs;
      continue;
    }

    if (isStaleSessionError(err)) {
      message = getErrorMessage(err);
      connecting = false;
      break;
    }

    if (now >= deadline) reachedDeadline = true;
    if (isRoutingError(err)) {
      message = VIDEO_ENDPOINT_UNREACHABLE_TEXT;
    } else if (isVideoPendingError(err) && now >= deadline) {
      message = VIDEO_UNAVAILABLE_TEXT;
    } else {
      message = getErrorMessage(err);
    }
    connecting = false;
    break;
  }

  return finalize(connecting, message, running, online, reachedDeadline);
}

function finalize(
  connecting: boolean,
  message: string,
  running: boolean,
  online: boolean,
  reachedDeadline: boolean,
): SimulateResult {
  const videoRendered = running && online && message === '';
  return {
    connecting,
    message,
    displayedText: videoRendered ? '' : placeholderText(connecting, message),
    videoRendered,
    reachedDeadline,
  };
}
