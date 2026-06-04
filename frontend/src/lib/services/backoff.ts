import { ApiRequestError } from '$lib/services/api';

export function createPollingBackoff(baseMs = 15000, maxMs = 60000) {
  let failures = 0;
  let retryAt = 0;

  return {
    canRequest() {
      return Date.now() >= retryAt;
    },
    reset() {
      failures = 0;
      retryAt = 0;
    },
    recordFailure(error: unknown) {
      const retryAfter = retryDelayFromError(error);
      if (retryAfter === false) return;
      failures += 1;
      const exponential = Math.min(maxMs, baseMs * (2 ** Math.max(0, failures - 1)));
      retryAt = Date.now() + Math.min(maxMs, retryAfter ?? exponential);
    },
  };
}

function retryDelayFromError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) return error.retryAfterMs;
    if (error.status && error.status >= 500) return null;
    return false;
  }
  if (error instanceof TypeError) return null;
  return false;
}
