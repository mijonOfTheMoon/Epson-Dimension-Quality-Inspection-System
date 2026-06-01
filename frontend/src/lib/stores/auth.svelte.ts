import type { User, UserRole } from '$lib/types/api';
import { api, tokenStorage, AUTH_LOGOUT_EVENT } from '$lib/services/api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

class AuthStore {
  user = $state<User | null>(null);
  status = $state<AuthStatus>('loading');

  private bound = false;

  async init() {
    if (this.bound) return;
    this.bound = true;

    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_LOGOUT_EVENT, () => {
        tokenStorage.clear();
        this.user = null;
        this.status = 'unauthenticated';
      });
    }

    const token = tokenStorage.get();
    if (!token) {
      this.status = 'unauthenticated';
      return;
    }
    try {
      this.user = await api.me();
      this.status = 'authenticated';
    } catch {
      tokenStorage.clear();
      this.user = null;
      this.status = 'unauthenticated';
    }
  }

  async login(username: string, password: string): Promise<boolean> {
    const result = await api.login(username, password);
    if (!result?.token || !result.user) return false;
    tokenStorage.set(result.token);
    this.user = result.user;
    this.status = 'authenticated';
    return true;
  }

  async logout() {
    try { await api.logout(); } catch { /* ignore */ }
    tokenStorage.clear();
    this.user = null;
    this.status = 'unauthenticated';
  }

  hasRole(...roles: UserRole[]): boolean {
    return !!this.user && roles.includes(this.user.role);
  }
}

export const auth = new AuthStore();
