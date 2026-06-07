function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:/i.test(value.trim());
}

function stripDataUrls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isDataUrl(item))
      .map((item) => stripDataUrls(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isDataUrl(item)) continue;
      result[key] = stripDataUrls(item);
    }
    return result as T;
  }
  return value;
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(stripDataUrls(value)));
  } catch {
    void 0;
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    void 0;
  }
}
