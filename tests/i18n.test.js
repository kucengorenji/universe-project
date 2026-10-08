import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import en from '../src/i18n/locales/en/index.js';
import id from '../src/i18n/locales/id/index.js';
import htmlId from '../src/i18n/locales/id/html.js';
import { t, setLocale, getLocale, hasKey, formatNumber, LOCALES, DEFAULT_LOCALE } from '../src/i18n/index.js';

const root = new URL('..', import.meta.url).pathname;
const PLURAL = /\.(zero|one|two|few|many|other)$/;
const base = (key) => key.replace(PLURAL, '');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('English is the default locale', () => {
  assert.equal(DEFAULT_LOCALE, 'en');
  assert.equal(getLocale(), 'en');
  assert.deepEqual(LOCALES.map((l) => l.code), ['en', 'id']);
});

test('English and Indonesian define the same keys', () => {
  const a = new Set(Object.keys(en).map(base)), b = new Set(Object.keys(id).map(base));
  assert.deepEqual([...a].filter((k) => !b.has(k)), [], 'missing in id');
  assert.deepEqual([...b].filter((k) => !a.has(k)), [], 'missing in en');
});

test('no translation is empty and placeholders match across languages', () => {
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim(), `en ${key} is empty`);
    const other = id[key] ?? id[base(key)] ?? id[`${base(key)}.other`];
    assert.ok(other?.trim(), `id ${key} is empty`);
    assert.equal(placeholders(other), placeholders(value), `${key}: placeholders differ`);
  }
});

test('every literal t() key used in the source exists in English', () => {
  const missing = [];
  for (const file of walk(join(root, 'src')).filter((f) => f.endsWith('.js') && !f.includes('/i18n/'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt(?:r)?\(\s*'([A-Za-z0-9_.]+)'\s*[,)]/g)) {
      const key = m[1];
      if (!(key in en) && !(`${key}.other` in en)) missing.push(`${relative(root, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('static pages: every data-i18n key has an Indonesian string, and none are stale', () => {
  const pages = ['index.html', 'play/index.html', 'skirmish.html'];
  const used = new Set();
  for (const page of pages) {
    const html = readFileSync(join(root, page), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.slice(pair.indexOf(':') + 1).trim());
  }
  const missing = [...used].filter((k) => !(k in htmlId));
  const stale = Object.keys(htmlId).filter((k) => !used.has(k));
  assert.deepEqual(missing, [], 'keys used in HTML but missing from id/html.js');
  assert.deepEqual(stale, [], 'keys in id/html.js that no page uses');
});

test('t() interpolates, formats numbers and picks plural forms', () => {
  assert.equal(t('planet.tiles', { count: 1 }), '1 tile');
  assert.equal(t('planet.tiles', { count: 2 }), '2 tiles');
  assert.equal(t('planet.tiles', { count: 10242 }), '10,242 tiles');
  assert.equal(t('planet.flight.over', { city: 'Amberfall' }), 'Above Amberfall. Press L to land');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(formatNumber(1234.5), '1,234.5');
});

test('switching to Indonesian changes text, plurals and number format, and back', () => {
  try {
    assert.equal(setLocale('id', { persist: false }), true);
    assert.equal(getLocale(), 'id');
    assert.equal(t('pause.resume'), 'Lanjut');
    assert.equal(t('planet.tiles', { count: 1 }), '1 tile');
    assert.equal(t('planet.tiles', { count: 10242 }), '10.242 tile');
    assert.equal(hasKey('pause.resume'), true);
    assert.equal(setLocale('xx', { persist: false }), false);
  } finally {
    setLocale('en', { persist: false });
  }
  assert.equal(t('pause.resume'), 'Resume');
});

test('a key missing from Indonesian falls back to English as a whole string', () => {
  try {
    setLocale('id', { persist: false });
    assert.equal(t('home.floors', { count: 2 }), '2 lantai');
  } finally {
    setLocale('en', { persist: false });
  }
});
