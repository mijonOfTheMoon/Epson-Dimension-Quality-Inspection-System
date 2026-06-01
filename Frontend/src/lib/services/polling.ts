export function startVisibilityPolling(callback: () => void, visibleMs = 3000, hiddenMs = 15000) {
  let timer: number | undefined;
  let stopped = false;

  const delay = () => (document.visibilityState === 'visible' ? visibleMs : hiddenMs);
  const schedule = () => {
    if (stopped) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      callback();
      schedule();
    }, delay());
  };
  const reschedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    callback();
    schedule();
  };

  document.addEventListener('visibilitychange', reschedule);
  schedule();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', reschedule);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
