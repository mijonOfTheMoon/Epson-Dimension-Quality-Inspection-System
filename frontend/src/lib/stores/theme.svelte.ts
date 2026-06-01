type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'diminspect_theme';

class ThemeStore {
  mode = $state<ThemeMode>('light');
  private bound = false;

  init() {
    if (this.bound || typeof window === 'undefined') return;
    this.bound = true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        this.mode = stored;
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        this.mode = 'dark';
      }
    } catch { /* ignore */ }
    this.apply();
  }

  toggle() {
    this.mode = this.mode === 'dark' ? 'light' : 'dark';
    this.apply();
    try { localStorage.setItem(STORAGE_KEY, this.mode); } catch { /* ignore */ }
  }

  private apply() {
    document.documentElement.classList.toggle('dark', this.mode === 'dark');
  }
}

export const theme = new ThemeStore();
