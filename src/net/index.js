import { getLocale, t } from '../i18n/index.js';
import { AccountPanel } from './accountPanel.js';
import { fetchAnnouncements, showNotice, unseen } from './announcements.js';
import { apiFetch } from './api.js';
import { Auth } from './auth.js';
import { CloudSync } from './cloudSave.js';
import { askChoice } from './dialog.js';
import { Progress } from './progress.js';
import { Telemetry } from './telemetry.js';

// Everything the game does with the backend, loaded after the first frame so
// it never delays boot: telemetry, Google sign-in + cloud sync, ?restore=,
// announcements, and the inspect-mode banner.

const FLUSH_MS = 30_000;
const HEARTBEAT_MS = 60_000;
const PLAYTIME_MS = 15_000;
const FPS_WINDOW_MS = 2_000;

function browserIndexedDB() {
  try { return globalThis.indexedDB ?? null; } catch { return null; }
}

function wireTelemetry(telemetry, { engine, world, director, missions, progress }) {
  telemetry.track('session_start');
  const worldEvent = (name) => telemetry.track('world', name, undefined, { worldId: world.worldId, seed: world.homeMap.seed, subdivision: world.subdivision });
  worldEvent(world.fresh ? 'created' : 'loaded');
  world.listeners.add(() => worldEvent('created'));

  let lastMode = null;
  const onRoute = (route) => {
    if (!route) return;
    progress.visit(world.worldId, route);
    if (route.mode !== lastMode) telemetry.track('mode', (lastMode = route.mode));
  };
  onRoute(director.route);
  director.listeners.add(onRoute);

  missions.listeners.add((kind, key) => {
    if (kind === 'item') telemetry.track('mission', key);
    else if (kind === 'mission') telemetry.track('mission_done', key);
  });

  window.addEventListener('error', (e) => telemetry.error(e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', (e) => telemetry.error(e.reason?.message || String(e.reason)));
  let reported = null;

  setInterval(() => {
    // Errors inside a mode are caught by the engine loop, so they never reach window.onerror.
    if (engine.lastError && engine.lastError !== reported) {
      reported = engine.lastError;
      telemetry.error(reported.message, reported.stack?.split('\n')[1]);
    }
    if (document.hidden) return;
    const start = engine.drawCount;
    setTimeout(() => {
      const playing = !engine.paused && !document.hidden;
      telemetry.track('heartbeat', undefined, playing ? Math.round((engine.drawCount - start) / (FPS_WINDOW_MS / 1000)) : undefined);
    }, FPS_WINDOW_MS);
  }, HEARTBEAT_MS);

  setInterval(() => {
    if (!document.hidden && !engine.paused) progress.addPlaytime(world.worldId, PLAYTIME_MS / 1000);
  }, PLAYTIME_MS);
  setInterval(() => telemetry.flush(), FLUSH_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) telemetry.flush(); });
  window.addEventListener('pagehide', () => {
    telemetry.track('session_end');
    telemetry.flush();
  });
}

async function showAnnouncements() {
  const items = unseen(await fetchAnnouncements('game'));
  if (!items.length) return;
  let host = document.querySelector('.notice-stack');
  if (!host) {
    host = document.createElement('div');
    host.className = 'notice-stack';
    document.body.append(host);
  }
  for (const a of items.slice(0, 3)) showNotice(host, a, { locale: getLocale(), closeLabel: t('net.notice.close') });
}

function showInspectBanner(save) {
  const bar = document.createElement('div');
  bar.className = 'inspect-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span><strong>${t('net.inspect.title')}</strong> ${t('net.inspect.text', { seed: String(save.meta.seed) })}</span><a class="pill pill--small" href="/play/">${t('net.inspect.leave')}</a>`;
  document.body.append(bar);
}

/**
 * @param {{ engine: any, world: any, director: any, missions: any, pause: any, inspect: null | { save?: any, failed?: boolean } }} game
 */
export async function setupNet({ engine, world, director, missions, pause, inspect }) {
  const readOnly = !!inspect?.save;
  const storage = globalThis.localStorage;
  const telemetry = new Telemetry({
    enabled: readOnly ? false : undefined,
    context: () => ({ locale: getLocale(), quality: engine.quality.preset, worldId: world.worldId })
  });
  const progress = new Progress(storage);
  const auth = new Auth(storage);
  const sync = new CloudSync({ world, storage, indexedDB: browserIndexedDB(), auth, progress, deviceId: telemetry.deviceId, dialog: askChoice, t });
  new AccountPanel(pause.accountSlot, { auth, sync, telemetry, inspect: readOnly ? inspect : null });

  if (readOnly) {
    showInspectBanner(inspect.save);
    return { telemetry, auth, sync };
  }
  if (inspect?.failed) await askChoice({ eyebrow: t('net.inspect.title'), title: t('net.inspect.failed'), choices: [{ id: 'ok', label: t('net.ok') }] });

  wireTelemetry(telemetry, { engine, world, director, missions, progress });

  auth.onChange(async (user) => {
    if (!user) return sync.stop();
    // Signing in attaches this device's anonymous history to the account.
    await apiFetch('/me/devices', { method: 'POST', token: await auth.token(), body: { deviceId: telemetry.deviceId } }).catch(() => {});
    await sync.start();
  });
  world.listeners.add(() => { if (auth.user) sync.check(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sync.tick(); });

  await auth.restore().catch((error) => console.warn('Sign-in could not be restored:', error));

  const restoreId = new URLSearchParams(location.search).get('restore');
  if (restoreId) {
    history.replaceState(null, '', `/play/${location.hash}`);
    await sync.restore(restoreId).catch((error) => console.warn('Restore failed:', error));
  }

  showAnnouncements();
  return { telemetry, auth, sync };
}
