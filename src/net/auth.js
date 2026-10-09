import { KEYS, storageOr } from './config.js';

// Google sign-in through Firebase Auth. The SDK is only downloaded when the
// player signs in, or at boot when a previous session should be restored, so
// anonymous players never pay for it.

export class Auth {
  constructor(storage) {
    this.storage = storageOr(storage);
    this.user = null;
    this.listeners = new Set();
    this.loading = null;
  }

  get wasSignedIn() {
    try { return this.storage?.getItem(KEYS.signedIn) === '1'; } catch { return false; }
  }

  remember(on) {
    try {
      if (on) this.storage?.setItem(KEYS.signedIn, '1');
      else this.storage?.removeItem(KEYS.signedIn);
    } catch { /* restore at boot is best effort */ }
  }

  load() {
    this.loading ||= Promise.all([import('../core/firebase.js'), import('firebase/auth')]).then(([{ app }, sdk]) => {
      this.sdk = sdk;
      this.auth = sdk.getAuth(app);
      sdk.onAuthStateChanged(this.auth, (user) => this.set(user));
      return this.auth;
    });
    return this.loading;
  }

  set(user) {
    if ((user?.uid ?? null) === (this.user?.uid ?? null)) return;
    this.user = user || null;
    this.remember(!!user);
    this.listeners.forEach((fn) => fn(this.user));
  }

  /** At boot: only touches Firebase if this browser signed in before. */
  async restore() {
    if (!this.wasSignedIn) return null;
    const auth = await this.load();
    await auth.authStateReady();
    this.set(auth.currentUser);
    return this.user;
  }

  async signIn() {
    const auth = await this.load();
    const result = await this.sdk.signInWithPopup(auth, new this.sdk.GoogleAuthProvider());
    this.set(result.user);
    return this.user;
  }

  async signOut() {
    if (this.auth) await this.sdk.signOut(this.auth);
    this.set(null);
  }

  async token() {
    return this.user ? this.user.getIdToken() : null;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
