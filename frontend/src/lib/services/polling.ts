export function startVisibilityPolling(callback: () => void | Promise<void>, visibleMs = 3000, hiddenMs = 15000) {
  let timer: number | undefined;
  let stopped = false;
  let running = false;

  const delay = () => (document.visibilityState === 'visible' ? visibleMs : hiddenMs);
  const schedule = () => {
    if (stopped || timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      void run();
    }, delay());
  };
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await callback();
    } finally {
      running = false;
      schedule();
    }
  };
  const reschedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    void run();
  };

  document.addEventListener('visibilitychange', reschedule);
  schedule();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', reschedule);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
