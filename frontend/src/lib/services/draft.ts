// Lightweight session-scoped draft persistence for editor forms.
// Keeps in-progress form data alive across navigation (and reloads within
// the same tab session) so users can leave an editor and resume later.

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
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or serialization errors; persistence is best-effort.
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
}
