import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { AppConfig } from '../config/env.js';
import type { User, UserRole } from '../domain/types.js';
import type { DataStore } from '../storage/store.js';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  name: string;
}

export type SafeUser = Omit<User, 'password'>;

export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: DataStore,
  ) {}

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.config.BCRYPT_ROUNDS);
  }

  verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  signToken(user: SafeUser): string {
    const payload: AuthTokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
    };
    const options: SignOptions = { expiresIn: this.config.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
    return jwt.sign(payload, this.config.JWT_SECRET, options);
  }

  verifyToken(token: string): AuthTokenPayload | null {
    try {
      return jwt.verify(token, this.config.JWT_SECRET) as AuthTokenPayload;
    } catch {
      return null;
    }
  }

  async login(username: string, password: string): Promise<{ user: SafeUser; token: string } | null> {
    const user = await this.store.findUserByUsername(username);
    if (!user) return null;
    const ok = await this.verifyPassword(password, user.password);
    if (!ok) return null;
    const safe = stripPassword(user);
    return { user: safe, token: this.signToken(safe) };
  }

  async resolveUser(token: string | undefined): Promise<SafeUser | null> {
    if (!token) return null;
    const payload = this.verifyToken(token);
    if (!payload) return null;
    const user = await this.store.findUserById(payload.sub);
    return user ? stripPassword(user) : null;
  }
}

export function stripPassword(user: User): SafeUser {
  const { password: _password, ...safe } = user;
  return safe;
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export function extractQueryToken(query: unknown): string | undefined {
  if (!query || typeof query !== 'object') return undefined;
  const token = (query as { token?: unknown; access_token?: unknown }).token
    ?? (query as { token?: unknown; access_token?: unknown }).access_token;
  if (typeof token !== 'string') return undefined;
  const trimmed = token.trim();
  return trimmed || undefined;
}
