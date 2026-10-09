import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { PlayerDetail as Detail } from '../../../../shared/api.ts';
import { request } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import { Card, ConfirmButton, ErrorNotice, StatTile, useApi } from '../../components/ui.tsx';
import { fmtAgo, fmtBytes, fmtDateTime, fmtDuration, fmtNumber, shortId } from '../../format.ts';
import { EventTable } from './Events.tsx';
import { openInspect } from './inspect.ts';
import { playerName } from './Players.tsx';

export function PlayerDetail() {
  const { key = '' } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, reload } = useApi<Detail>(`/admin/players/${encodeURIComponent(key)}`);
  if (error) return <ErrorNotice error={error} retry={reload} text="Gagal memuat pemain:" />;
  if (!data) return <p className="small muted">Memuat…</p>;
  const p = data.player;
  const playtime = data.sessions.reduce((s, x) => s + Math.max(0, x.lastSeenAt - x.startedAt) / 1000, 0);

  return (
    <>
      <header className="page-head">
        <div className="section" style={{ gap: 8 }}>
          <Link to="/admin/players" className="small muted">← Semua pemain</Link>
          <h2 className="section-title" style={{ fontSize: 48 }}>{playerName(p)}</h2>
          <p className="small muted">{p.userId ? `Akun Google · uid ${p.userId}` : `Anonim · perangkat ${p.key.slice(2)}`}</p>
        </div>
        <ConfirmButton label="Hapus pemain & semua datanya" confirmLabel="Yakin? Tidak bisa dibatalkan — klik lagi" onConfirm={async () => {
          await request(token, `/admin/players/${encodeURIComponent(key)}`, { method: 'DELETE' });
          navigate('/admin/players');
        }} />
      </header>
      {problem ? <p className="notice notice--error" role="alert">{problem}</p> : null}

      <section className="kpis" aria-label="Ringkasan pemain">
        <StatTile label="Terakhir terlihat" value={fmtAgo(p.lastSeen)} note={fmtDateTime(p.lastSeen)} />
        <StatTile label="Pertama terlihat" value={fmtAgo(p.firstSeen)} note={fmtDateTime(p.firstSeen)} />
        <StatTile label="Perangkat" value={fmtNumber(p.devices)} />
        <StatTile label="Sesi (50 terakhir)" value={fmtNumber(data.sessions.length)} note={`${fmtDuration(playtime)} main`} />
      </section>

      <Card title="Dunia">
        {data.worlds.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Seed</th><th>World ID</th><th>Cloud save</th><th>Terakhir</th><th className="num">Planet / kota</th><th /></tr></thead>
              <tbody>{data.worlds.map((w) => (
                <tr key={`${w.worldId}:${w.deviceId}`}>
                  <td>{w.seed ?? '—'}</td>
                  <td className="mono">{w.worldId}</td>
                  <td>{w.rev ? `rev ${w.rev} · ${fmtBytes(w.size ?? 0)}` : <span className="muted">tidak ada</span>}</td>
                  <td>{fmtAgo(w.lastSeen)}</td>
                  <td className="num">{w.meta ? `${w.meta.planetsLanded} / ${w.meta.townsVisited}` : '—'}</td>
                  <td className="num">{w.rev && w.userId ? <button type="button" className="pill pill--ghost pill--small" onClick={() => openInspect(token, w.userId!, w.worldId).catch((e) => setProblem(`Inspect gagal: ${(e as Error).message}`))}>Buka (lihat saja) ↗</button> : null}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="small muted">Belum ada dunia.</p>}
      </Card>

      <Card title="Perangkat">
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Pertama</th><th>Terakhir</th><th>Negara</th></tr></thead>
            <tbody>{data.devices.map((d) => <tr key={d.id}><td className="mono" title={d.id}>{shortId(d.id)}</td><td>{fmtDateTime(d.createdAt)}</td><td>{fmtAgo(d.lastSeenAt)}</td><td>{d.country ?? '—'}</td></tr>)}</tbody>
          </table>
          {!data.devices.length ? <p className="empty">Login dari dashboard saja, belum main dengan akun ini.</p> : null}
        </div>
      </Card>

      <Card title="Sesi terakhir">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mulai</th><th className="num">Durasi</th><th>Mode terakhir</th><th>Grafis</th><th className="num">FPS</th><th className="num">Error</th><th>Browser</th><th>Negara</th></tr></thead>
            <tbody>{data.sessions.map((s) => (
              <tr key={s.id}>
                <td>{fmtDateTime(s.startedAt)}</td>
                <td className="num">{fmtDuration((s.lastSeenAt - s.startedAt) / 1000)}</td>
                <td>{s.mode ?? '—'}</td>
                <td>{s.quality ?? '—'}</td>
                <td className="num">{s.fps ?? '—'}</td>
                <td className="num">{s.errors}</td>
                <td>{s.ua ?? '—'}</td>
                <td>{s.country ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!data.sessions.length ? <p className="empty">Tidak ada sesi dalam 90 hari.</p> : null}
        </div>
      </Card>

      <Card title="Event terakhir"><EventTable events={data.events} /></Card>
    </>
  );
}
