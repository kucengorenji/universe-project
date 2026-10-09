import { KEYS, apiUrl, readJson, storageOr, writeJson } from './config.js';

// Admin announcements: a banner on the landing page, a card in the game.
// Each one shows once per browser (ids remembered in localStorage).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function fetchAnnouncements(surface) {
  try {
    const res = await fetch(apiUrl(`/announcements?surface=${surface}`));
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch {
    return []; // offline, or no API on this host
  }
}

/** The text in the page language, falling back to the other one. */
export function localized(a, locale) {
  const pick = (o) => (locale === 'id' ? o.id || o.en : o.en || o.id) || '';
  return { title: pick(a.title), body: pick(a.body) };
}

export function unseen(items, storage) {
  const seen = new Set(readJson(storageOr(storage), KEYS.announcements, []));
  return items.filter((a) => !seen.has(a.id));
}

export function markSeen(id, storage) {
  const s = storageOr(storage);
  const seen = readJson(s, KEYS.announcements, []).filter((x) => x !== id);
  writeJson(s, KEYS.announcements, [...seen, id].slice(-100));
}

/** Renders a dismissible notice into `host`; resolves when it is closed. */
export function showNotice(host, a, { locale, closeLabel, className = 'notice' }) {
  const { title, body } = localized(a, locale);
  const el = document.createElement('aside');
  el.className = `${className}${a.level === 'important' ? ` ${className}--important` : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="${className}__body"><strong>${esc(title)}</strong>${body ? `<p>${esc(body)}</p>` : ''}</div>
    <button type="button" class="menu-circle menu-circle--close menu-circle--small" aria-label="${esc(closeLabel)}"><span></span><span></span></button>`;
  host.append(el);
  return new Promise((resolve) => {
    el.querySelector('button').addEventListener('click', () => {
      markSeen(a.id);
      el.remove();
      resolve();
    });
  });
}
