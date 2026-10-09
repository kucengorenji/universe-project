export const fmtNumber = (n: number, locale = 'id-ID') => new Intl.NumberFormat(locale).format(n);

export const fmtCompact = (n: number, locale = 'id-ID') =>
  Math.abs(n) < 10_000 ? fmtNumber(n, locale) : new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(sec: number, locale = 'id-ID') {
  const id = locale.startsWith('id');
  if (sec < 60) return `${Math.round(sec)} ${id ? 'dtk' : 's'}`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} ${id ? 'mnt' : 'min'}`;
  const h = Math.floor(m / 60);
  return `${h} ${id ? 'j' : 'h'} ${m % 60} ${id ? 'mnt' : 'min'}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

export function fmtAgo(ms: number | null | undefined, locale = 'id-ID', now = Date.now()) {
  if (!ms) return '—';
  const sec = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  return rtf.format(0, 'minute');
}

export const fmtDateTime = (ms: number | null | undefined, locale = 'id-ID') =>
  ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '—';

export const fmtDay = (day: string, locale = 'id-ID') =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.parse(`${day}T00:00:00Z`));

/** 0, 5, 10… style axis ticks covering [0, max]. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export const shortId = (id: string) => id.slice(0, 8);
