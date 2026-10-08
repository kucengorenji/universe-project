// Internationalization: English (US) is the default and the source language,
// Indonesian is the second language. The choice is stored in localStorage and
// can be forced with ?lang=id. There is no browser-language sniffing on purpose.
//
//   t('pause.title')                   string by key
//   t('city.count', { count: 3 })      {placeholders}; picks 'city.count.one' / '.other' by plural rule
//   applyDom(root)                     fills [data-i18n*] markup (static pages)
//
// Static HTML keeps the English text in the markup (it is the source of truth, and
// what crawlers and no-JS visitors see); only other languages overwrite it.

import en from './locales/en/index.js';
import id from './locales/id/index.js';
import htmlId from './locales/id/html.js';

export const LOCALES = [
  { code: 'en', label: 'English', short: 'EN', intl: 'en-US' },
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID', intl: 'id-ID' }
];
export const DEFAULT_LOCALE = 'en';

const STORAGE_KEY = 'planet_globe_locale';
const DICTS = { en, id: { ...id, ...htmlId } };
const known = (code) => LOCALES.some((l) => l.code === code);

function initialLocale() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (known(q)) {
      try { localStorage.setItem(STORAGE_KEY, q); } catch { /* optional */ }
      return q;
    }
  } catch { /* no location (node tests) */ }
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (known(saved)) return saved;
  } catch { /* storage blocked */ }
  return DEFAULT_LOCALE;
}

let locale = initialLocale();
let rules = new Intl.PluralRules(intlTag());
const listeners = new Set();

function intlTag() {
  return LOCALES.find((l) => l.code === locale).intl;
}

if (typeof document !== 'undefined') document.documentElement.lang = locale;

export const getLocale = () => locale;
export const onLocaleChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

/** Switch language, remember it and notify listeners. Pages that cannot re-render call reload() afterwards. */
export function setLocale(code, { persist = true } = {}) {
  if (!known(code) || code === locale) return false;
  locale = code;
  rules = new Intl.PluralRules(intlTag());
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* optional */ }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  listeners.forEach((fn) => fn(code));
  return true;
}

function lookup(key, params) {
  const plural = params && typeof params.count === 'number' ? `${key}.${rules.select(params.count)}` : null;
  // A missing translation falls back to English as a whole, never mixes the two
  for (const dict of [DICTS[locale], DICTS[DEFAULT_LOCALE]]) {
    if (plural && plural in dict) return dict[plural];
    if (key in dict) return dict[key];
  }
  return undefined;
}

export function t(key, params) {
  const raw = lookup(key, params);
  if (raw === undefined) return key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? formatNumber(v) : String(v);
  });
}

export const hasKey = (key, code = locale) => key in (DICTS[code] || {});

export function formatNumber(n, options) {
  return new Intl.NumberFormat(intlTag(), options).format(n);
}

/** Keys that exist in a locale; used by the parity test. */
export const dictionary = (code) => DICTS[code];

// ---------------------------------------------------------------- static markup

const originals = new WeakMap(); // element -> { text, html, attrs } in the source language

function remember(el) {
  let o = originals.get(el);
  if (!o) originals.set(el, (o = { attrs: {} }));
  return o;
}

function pairs(spec) {
  return spec.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(':');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
}

/**
 * data-i18n="key"                 textContent
 * data-i18n-html="key"            innerHTML (dictionary values are ours, never user input)
 * data-i18n-attr="aria-label:key; alt:key"   attributes
 * In English the markup is left alone. Switching back restores the remembered original.
 */
export function applyDom(root = document) {
  const swap = locale !== DEFAULT_LOCALE;
  const dict = DICTS[locale];
  for (const el of root.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]')) {
    const o = remember(el);
    const textKey = el.dataset.i18n, htmlKey = el.dataset.i18nHtml;
    if (textKey) {
      o.text ??= el.textContent;
      el.textContent = swap && textKey in dict ? dict[textKey] : o.text;
    }
    if (htmlKey) {
      o.html ??= el.innerHTML;
      el.innerHTML = swap && htmlKey in dict ? dict[htmlKey] : o.html;
    }
    if (el.dataset.i18nAttr) {
      for (const [attr, key] of pairs(el.dataset.i18nAttr)) {
        if (!(attr in o.attrs)) o.attrs[attr] = el.getAttribute(attr);
        el.setAttribute(attr, swap && key in dict ? dict[key] : o.attrs[attr]);
      }
    }
  }
}
