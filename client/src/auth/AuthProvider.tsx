import type { AuthStatus, LoginResponse, SessionResponse, User } from '@ibutest/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionChange, refreshSession, setSession } from '../api/client';

interface AuthState {
  ready: boolean;
  status: AuthStatus | null;
  statusError: boolean;
  user: User | null;
  login(email: string, password: string): Promise<{ mfaToken: string } | null>;
  verifyMfa(mfaToken: string, code: string): Promise<void>;
  completeSession(session: SessionResponse): void;
  logout(): Promise<void>;
  setUser(user: User): void;
  reloadStatus(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthLoadResult {
  status: AuthStatus | null;
  user: User | null;
  failed: boolean;
}

/** Reads server status and restores the session from the refresh cookie (no React state here). */
async function loadAuthState(): Promise<AuthLoadResult> {
  try {
    const status = await api<AuthStatus>('/auth/status');
    if (status.setupRequired) return { status, user: null, failed: false };
    const session = await refreshSession();
    return { status, user: session?.user ?? null, failed: false };
  } catch {
    return { status: null, user: null, failed: true };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const applyAuthState = useCallback((result: AuthLoadResult) => {
    setStatusError(result.failed);
    if (!result.failed) {
      setStatus(result.status);
      setUser(result.user);
    }
    setReady(true);
  }, []);

  const reloadStatus = useCallback(async () => {
    setReady(false);
    applyAuthState(await loadAuthState());
  }, [applyAuthState]);

  useEffect(() => {
    void loadAuthState().then(applyAuthState);
    return onSessionChange((session) => {
      if (session) setUser(session.user);
      else {
        setUser(null);
        queryClient.clear();
      }
    });
  }, [applyAuthState, queryClient]);

  const completeSession = useCallback((session: SessionResponse) => {
    setSession(session);
    setStatus((s) => (s ? { ...s, setupRequired: false } : s));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
      if ('mfaRequired' in res) return { mfaToken: res.mfaToken };
      completeSession(res);
      return null;
    },
    [completeSession],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      completeSession(await api<SessionResponse>('/auth/mfa/verify', { method: 'POST', body: { mfaToken, code } }));
    },
    [completeSession],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, status, statusError, user, login, verifyMfa, completeSession, logout, setUser, reloadStatus }),
    [ready, status, statusError, user, login, verifyMfa, completeSession, logout, reloadStatus],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
