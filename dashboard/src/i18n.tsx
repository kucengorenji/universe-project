import { createContext, useContext, useState, type ReactNode } from 'react';
import enCore from '../../src/i18n/locales/en/core.js';
import idCore from '../../src/i18n/locales/id/core.js';

// The player pages speak Indonesian and English (like the game); the admin
// pages are an internal tool and stay in Indonesian.

export type Lang = 'id' | 'en';
const KEY = 'dashboard_lang';

const STRINGS = {
  id: {
    'app.title': 'Dashboard',
    'nav.worlds': 'Dunia saya',
    'nav.admin': 'Admin',
    'nav.signout': 'Keluar',
    'nav.play': 'Main ↗',
    'signin.title': 'Dunia kamu, di mana saja.',
    'signin.lead': 'Masuk dengan akun Google yang sama seperti di game untuk melihat dunia yang tersimpan di cloud, progres misi, dan data kamu.',
    'signin.button': 'Masuk dengan Google',
    'signin.anon': 'Main tanpa akun? Progresmu tetap tersimpan di browser. Untuk menyimpannya ke cloud, buka game, tekan P, lalu pilih Masuk dengan Google.',
    'signin.dev': 'Masuk (dev) sebagai',
    'signin.failed': 'Gagal masuk: {error}',
    'worlds.title': 'Dunia saya',
    'worlds.lead': 'Dunia yang disinkronkan dari game. Lanjutkan di perangkat mana pun dengan akun ini.',
    'worlds.empty': 'Belum ada dunia di cloud. Buka game, tekan P, lalu Masuk dengan Google. Dunia yang sedang kamu mainkan akan tersimpan otomatis.',
    'worlds.seed': 'Seed',
    'worlds.saved': 'Tersimpan {when}',
    'worlds.rev': 'revisi {rev}',
    'worlds.planets': 'Planet didarati',
    'worlds.towns': 'Kota dikunjungi',
    'worlds.playtime': 'Waktu main',
    'worlds.homes': 'Rumah',
    'worlds.missions': 'Misi',
    'worlds.missionsDone': '{done} dari {total} langkah misi',
    'worlds.restore': 'Lanjutkan di perangkat ini',
    'worlds.download': 'Unduh JSON',
    'worlds.delete': 'Hapus',
    'worlds.deleteConfirm': 'Yakin? Klik lagi',
    'devices.title': 'Perangkat',
    'devices.lead': 'Browser yang tertaut saat kamu masuk di game. Riwayat anonimnya ikut ke akun ini.',
    'devices.empty': 'Belum ada perangkat tertaut.',
    'devices.lastSeen': 'Terakhir terlihat {when}',
    'devices.unlink': 'Lepas',
    'data.title': 'Data & privasi',
    'data.lead': 'Game mengirim data penggunaan anonim (sesi, misi, frame rate, error) tanpa alamat IP; event mentah disimpan 90 hari. Kamu bisa mematikannya di menu game (P).',
    'data.export': 'Unduh semua data (JSON)',
    'data.delete': 'Hapus akun dan semua data',
    'data.deleteConfirm': 'Ini menghapus semua dunia di cloud dan riwayat. Klik lagi untuk menghapus.',
    'data.deleted': 'Akun dan data sudah dihapus.',
    'common.loading': 'Memuat…',
    'common.error': 'Terjadi kesalahan: {error}',
    'common.retry': 'Coba lagi',
    'lang.switch': 'English'
  },
  en: {
    'app.title': 'Dashboard',
    'nav.worlds': 'My worlds',
    'nav.admin': 'Admin',
    'nav.signout': 'Sign out',
    'nav.play': 'Play ↗',
    'signin.title': 'Your worlds, anywhere.',
    'signin.lead': 'Sign in with the same Google account you use in the game to see your cloud worlds, mission progress and your data.',
    'signin.button': 'Sign in with Google',
    'signin.anon': 'Playing without an account? Your progress stays in your browser. To keep it in the cloud, open the game, press P and choose Sign in with Google.',
    'signin.dev': 'Sign in (dev) as',
    'signin.failed': 'Sign-in failed: {error}',
    'worlds.title': 'My worlds',
    'worlds.lead': 'Worlds synced from the game. Continue on any device with this account.',
    'worlds.empty': 'No worlds in the cloud yet. Open the game, press P and sign in with Google. The world you are playing then saves on its own.',
    'worlds.seed': 'Seed',
    'worlds.saved': 'Saved {when}',
    'worlds.rev': 'revision {rev}',
    'worlds.planets': 'Planets landed',
    'worlds.towns': 'Towns visited',
    'worlds.playtime': 'Play time',
    'worlds.homes': 'Homes',
    'worlds.missions': 'Missions',
    'worlds.missionsDone': '{done} of {total} mission steps',
    'worlds.restore': 'Continue on this device',
    'worlds.download': 'Download JSON',
    'worlds.delete': 'Delete',
    'worlds.deleteConfirm': 'Sure? Click again',
    'devices.title': 'Devices',
    'devices.lead': 'Browsers linked when you signed in from the game. Their anonymous history moved to this account.',
    'devices.empty': 'No linked devices yet.',
    'devices.lastSeen': 'Last seen {when}',
    'devices.unlink': 'Unlink',
    'data.title': 'Data & privacy',
    'data.lead': 'The game sends anonymous usage data (sessions, missions, frame rate, errors) without IP addresses; raw events are kept for 90 days. You can turn it off in the game menu (P).',
    'data.export': 'Download all data (JSON)',
    'data.delete': 'Delete account and all data',
    'data.deleteConfirm': 'This deletes every cloud world and all history. Click again to delete.',
    'data.deleted': 'Your account and data were deleted.',
    'common.loading': 'Loading…',
    'common.error': 'Something went wrong: {error}',
    'common.retry': 'Try again',
    'lang.switch': 'Bahasa Indonesia'
  }
} as const;

export type Key = keyof typeof STRINGS.id;
type Params = Record<string, string | number>;

const fill = (s: string, params?: Params) => (params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : s);
const CORE: Record<Lang, Record<string, string>> = { id: idCore, en: enCore };

interface I18n {
  lang: Lang;
  setLang(l: Lang): void;
  t(key: Key, params?: Params): string;
  /** A game string (e.g. mission labels), straight from the game's locale files. */
  game(key: string): string;
  locale: string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(KEY) === 'en' ? 'en' : 'id'));
  const setLang = (l: Lang) => {
    localStorage.setItem(KEY, l);
    document.documentElement.lang = l;
    setLangState(l);
  };
  const value: I18n = {
    lang,
    setLang,
    locale: lang === 'id' ? 'id-ID' : 'en-US',
    t: (key, params) => fill(STRINGS[lang][key], params),
    game: (key) => CORE[lang][key] ?? CORE.en[key] ?? key
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
