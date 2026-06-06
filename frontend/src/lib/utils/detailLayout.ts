export type DetailLayout = 'split' | 'stacked' | 'full';

export const DETAIL_BREAKPOINT_PX = 1024;

export function resolveDetailLayout(viewportWidth: number, hasFrame: boolean): DetailLayout {
  if (!hasFrame) {
    return 'full';
  }

  if (viewportWidth >= DETAIL_BREAKPOINT_PX) {
    return 'split';
  }

  return 'stacked';
}
