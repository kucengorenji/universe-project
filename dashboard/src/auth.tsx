import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, deleteUser, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { firebaseConfig } from '../../src/core/firebaseConfig.js';
import type { Me } from '../../shared/api.ts';
import { request, type TokenSource } from './api.ts';
import { DEV_AUTH } from './config.ts';

const auth = getAuth(initializeApp(firebaseConfig));
const DEV_KEY = 'dashboard_dev_email';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  error: string | null;
  token: TokenSource;
  signIn(): Promise<void>;
  devSignIn(email: string): void;
  signOut(): Promise<void>;
  /** Removes the Firebase account too, when Google allows it without a fresh sign-in. */
  deleteFirebaseUser(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [devEmail, setDevEmail] = useState<string | null>(() => (DEV_AUTH ? localStorage.getItem(DEV_KEY) : null));
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const token = useCallback<TokenSource>(async () => {
    if (devEmail) return `dev:${devEmail}`;
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  }, [devEmail]);

  const signedIn = !!devEmail || !!user;
  const refresh = useCallback(async () => {
    if (!signedIn) { setMe(null); return; }
    try {
      setMe(await request<Me>(token, '/me'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [signedIn, token]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    status: user === undefined && !devEmail ? 'loading' : signedIn ? 'signedIn' : 'signedOut',
    me,
    error,
    token,
    refresh,
    async signIn() {
      setError(null);
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (e) {
        const code = (e as { code?: string }).code || '';
        if (!/popup-closed|cancelled-popup/.test(code)) setError(code || (e as Error).message);
      }
    },
    devSignIn(email: string) {
      localStorage.setItem(DEV_KEY, email);
      setDevEmail(email);
    },
    async signOut() {
      localStorage.removeItem(DEV_KEY);
      setDevEmail(null);
      setMe(null);
      await signOut(auth);
    },
    async deleteFirebaseUser() {
      if (auth.currentUser) await deleteUser(auth.currentUser).catch(() => {}); // needs a recent sign-in; the data is already gone
    }
  }), [user, devEmail, signedIn, me, error, token, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
