import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, UserRole } from '../types/api';
import { api, AUTH_LOGOUT_EVENT, tokenStorage } from '../services/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextType {
  user: User | null;
  status: AuthStatus;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    const token = tokenStorage.get();
    if (!token) {
      setStatus('unauthenticated');
      return () => { cancelled = true; };
    }
    api.me()
      .then((current) => {
        if (cancelled) return;
        setUser(current);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        tokenStorage.clear();
        setUser(null);
        setStatus('unauthenticated');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = () => {
      tokenStorage.clear();
      setUser(null);
      setStatus('unauthenticated');
    };
    window.addEventListener(AUTH_LOGOUT_EVENT, handler);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    if (!result?.token || !result.user) return false;
    tokenStorage.set(result.token);
    setUser(result.user);
    setStatus('authenticated');
    return true;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    tokenStorage.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const hasRole = useCallback(
    (...roles: UserRole[]) => !!user && roles.includes(user.role),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, status, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
