export type DetailPhase = 'idle' | 'loading' | 'loaded' | 'error';

export interface DetailLoadState {
  phase: DetailPhase;
  error?: string;
}

export type DetailLoadEvent =
  | { type: 'expand' }
  | { type: 'resolve' }
  | { type: 'reject'; error: string }
  | { type: 'timeout' }
  | { type: 'collapse' };

export const DETAIL_TIMEOUT_MS = 10000;

export function detailLoadReducer(state: DetailLoadState, event: DetailLoadEvent): DetailLoadState {
  switch (event.type) {
    case 'expand':
      return { phase: 'loading' };
    case 'resolve':
      return { phase: 'loaded' };
    case 'reject':
      return { phase: 'error', error: event.error };
    case 'timeout':
      return { phase: 'error', error: 'Waktu muat detail habis' };
    case 'collapse':
      return { phase: 'idle' };
    default:
      return state;
  }
}
