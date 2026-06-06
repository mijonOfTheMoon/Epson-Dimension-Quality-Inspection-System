export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

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
