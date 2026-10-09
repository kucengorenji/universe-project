// Production talks to the API on the game's origin; dev goes through the Vite proxy.
const env = import.meta.env;

export const API_BASE = (env.VITE_API_BASE ?? (env.PROD ? 'https://aethergate.cloud' : '')).replace(/\/$/, '');
export const GAME_URL = (env.VITE_GAME_URL ?? (env.PROD ? 'https://aethergate.cloud' : 'http://localhost:8788')).replace(/\/$/, '');
/** Dev only: sign in as any email without Google (the API accepts it on localhost with DEV_AUTH=1). */
export const DEV_AUTH = env.DEV && env.VITE_DEV_AUTH === '1';

export const restoreUrl = (worldId: string) => `${GAME_URL}/play/?restore=${encodeURIComponent(worldId)}`;
