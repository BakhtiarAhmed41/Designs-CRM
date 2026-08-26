import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import * as authApi from '@/lib/auth';
import { clearSessionTokens } from '@/lib/session';
import type { CurrentUser } from '@/lib/types';

type RegisterInput = {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
};

type AuthState = {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<CurrentUser>;
  register: (data: RegisterInput) => Promise<{
    user: CurrentUser;
    pending: boolean;
    emailSent?: boolean;
    verifyToken?: string | null;
  }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const res = await authApi.getMe();
      setUser(res.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        try {
          const r = await authApi.refresh();
          if (r.ok) {
            const res = await authApi.getMe();
            setUser(res.user);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      clearSessionTokens();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await loadMe();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setUser(res.user);
    try {
      const me = await authApi.getMe();
      setUser(me.user);
      return me.user;
    } catch {
      return res.user;
    }
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    return authApi.register(data);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, refresh: loadMe }),
    [user, loading, login, register, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
