export interface Env {
  DB: D1Database;
  /** Firebase project whose ID tokens are accepted (aud/iss). */
  FIREBASE_PROJECT_ID: string;
  /** Secret: comma-separated emails allowed into /api/admin. */
  ADMIN_EMAILS?: string;
  /** Comma-separated origins allowed to call the API cross-origin (the dashboard). */
  DASHBOARD_ORIGINS?: string;
  /** Where "open this world" links point; defaults to the API's own origin. */
  GAME_ORIGIN?: string;
  /** Secret: HMAC key for short-lived inspect links. Inspect is off without it. */
  INSPECT_SECRET?: string;
  /** "1" accepts `Bearer dev:<email>` from localhost only. Never set in production. */
  DEV_AUTH?: string;
}

export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}
