import { useState } from 'react';
import type { Overview as OverviewData } from '../../../../shared/api.ts';
import { BarList, SeriesChart } from '../../components/charts.tsx';
import { Card, ErrorNotice, StatTile, useApi } from '../../components/ui.tsx';
import { fmtAgo, fmtCompact, fmtDay, fmtDuration, fmtNumber } from '../../format.ts';
import { MISSIONS } from '../../../../src/core/missionList.js';
import idCore from '../../../../src/i18n/locales/id/core.js';

const RANGES = [7, 30, 90] as const;
const MODE_LABEL: Record<string, string> = { space: 'Luar angkasa', planet: 'Planet', town: 'Kota', home: 'Rumah' };
const QUALITY_LABEL: Record<string, string> = { auto: 'Auto', high: 'Tinggi', medium: 'Sedang', low: 'Rendah', unknown: 'Tidak diketahui' };
const label = (key: string) => (idCore as Record<string, string>)[key] ?? key;

export function Overview() {
  const [days, setDays] = useState<number>(30);
  const { data, error, loading, reload } = useApi<OverviewData>(`/admin/overview?days=${days}`);
  if (error && !data) return <ErrorNotice error={error} retry={reload} text="Gagal memuat ringkasan:" />;
  if (!data) return <p className="small muted">Memuat…</p>;
  const k = data.kpis;
  const series = (pick: (d: OverviewData['daily'][number]) => number) => data.daily.map((d) => ({ key: d.day, label: fmtDay(d.day), value: pick(d) }));
  const stale = loading;

  // Mission funnel in the game's own order, scaled to every player seen.
  const done = new Map(data.missions.map((m) => [m.mission, m]));
  const players = Math.max(1, k.players);

  return (
    <>
      <div className="filters" role="group" aria-label="Rentang waktu">
        <div className="seg">{RANGES.map((r) => <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}>{r} hari</button>)}</div>
        <span className="small muted">Diperbarui {fmtAgo(data.generatedAt)}{loading ? ' · memuat…' : ''}</span>
      </div>

      <section className={`kpis${stale ? ' chart is-stale' : ''}`} aria-label="Angka utama">
        <StatTile hero label="Pemain aktif hari ini" value={fmtNumber(k.activeToday)} note={`${fmtNumber(k.active7d)} dalam 7 hari`} />
        <StatTile label="Sesi hari ini" value={fmtNumber(k.sessionsToday)} />
        <StatTile label="Total pemain" value={fmtCompact(k.players)} note={`${fmtNumber(k.signedIn)} dengan akun Google`} />
        <StatTile label="Dunia" value={fmtCompact(k.worlds)} note={`${fmtNumber(k.cloudSaves)} di cloud`} />
        <StatTile label="Rata-rata sesi (7 hari)" value={fmtDuration(k.avgSessionSec7d)} />
        <StatTile label="Frame rate (7 hari)" value={k.fps7d === null ? '—' : `${k.fps7d}`} note="fps rata-rata" />
        <StatTile label="Error 24 jam" value={fmtNumber(k.errors24h)} />
      </section>

      <div className="grid-2">
        <Card title="Pemain aktif per hari"><SeriesChart kind="line" data={series((d) => d.activeDevices)} valueLabel="Pemain aktif" stale={stale} /></Card>
        <Card title="Sesi per hari"><SeriesChart kind="columns" data={series((d) => d.sessions)} valueLabel="Sesi" stale={stale} /></Card>
        <Card title="Waktu main per hari"><SeriesChart kind="line" data={series((d) => Math.round(d.playtimeSec / 360) / 10)} valueLabel="Jam main" format={(v) => `${v.toLocaleString('id-ID')} j`} stale={stale} /></Card>
        <Card title="Dunia baru per hari"><SeriesChart kind="columns" data={series((d) => d.worldsCreated)} valueLabel="Dunia baru" stale={stale} /></Card>
      </div>

      <Card title="Funnel misi" aside={<span className="small muted">pemain yang menyelesaikan tiap langkah, dari {fmtNumber(k.players)} pemain · 90 hari</span>}>
        <div className="funnel">
          {MISSIONS.map((m) => {
            const row = done.get(m.id);
            const items = new Map(row?.items.map((i) => [i.item, i.done]) ?? []);
            return (
              <div key={m.id}>
                <h4>{label(`mission.${m.id}.title`)}<span>{fmtNumber(row?.done ?? 0)} selesai</span></h4>
                <BarList max={players} items={m.items.map((it) => ({ key: it.id, label: label(`mission.${m.id}.${it.id}`), value: items.get(it.id) ?? 0 }))}
                  describe={(it) => `${Math.round((it.value / players) * 100)}% dari ${fmtNumber(k.players)} pemain`} />
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Mode yang dibuka" aside={<span className="small muted">7 hari</span>}>
          <BarList items={data.modes.map((m) => ({ key: m.mode, label: MODE_LABEL[m.mode] ?? m.mode, value: m.count }))} describe={() => 'kali masuk mode'} />
        </Card>
        <Card title="Preset grafis" aside={<span className="small muted">sesi 7 hari</span>}>
          <BarList items={data.quality.map((q) => ({ key: q.quality, label: QUALITY_LABEL[q.quality] ?? q.quality, value: q.sessions }))} describe={() => 'sesi'} />
        </Card>
      </div>

      <Card title="Error teratas" aside={<span className="small muted">7 hari</span>}>
        {data.errors.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pesan</th><th className="num">Jumlah</th><th>Terakhir</th></tr></thead>
              <tbody>{data.errors.map((e) => <tr key={e.message}><td className="mono">{e.message}</td><td className="num">{fmtNumber(e.count)}</td><td>{fmtAgo(e.lastAt)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="small muted">Tidak ada error dalam 7 hari terakhir.</p>}
      </Card>
    </>
  );
}
