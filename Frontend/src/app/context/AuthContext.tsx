import React, { createContext, useContext, useState, type ReactNode } from 'react';
import { type User, type UserRole } from '../data/mock-data';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = (username: string, password: string) => {
    return api.login(username, password).then((found) => {
      if (found) {
        setUser(found);
        return true;
      }
      return false;
    });
  };

  const logout = () => setUser(null);
  const hasRole = (...roles: UserRole[]) => !!user && roles.includes(user.role);

  return <AuthContext.Provider value={{ user, login, logout, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
