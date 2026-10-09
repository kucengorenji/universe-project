import { useState } from 'react';
import { Link } from 'react-router';
import type { Page, WorldRow } from '../../../../shared/api.ts';
import { useAuth } from '../../auth.tsx';
import { ErrorNotice, Pager, useApi } from '../../components/ui.tsx';
import { fmtAgo, fmtBytes, fmtDuration, shortId } from '../../format.ts';
import { openInspect } from './inspect.ts';

const LIMIT = 50;

export function WorldsAdmin() {
  const { token } = useAuth();
  const [offset, setOffset] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Page<WorldRow>>(`/admin/worlds?limit=${LIMIT}&offset=${offset}`);
  return (
    <section className="section">
      <p className="lead">Dunia dari telemetri (per perangkat) dan dari cloud save. Seed bisa sama di antara pemain, jadi tiap baris adalah satu pemilik.</p>
      {error ? <ErrorNotice error={error} retry={reload} text="Gagal memuat dunia:" /> : null}
      {problem ? <p className="notice notice--error" role="alert">{problem}</p> : null}
      <div className={`table-wrap${loading && data ? ' chart is-stale' : ''}`}>
        <table>
          <thead><tr><th>Seed</th><th>Pemilik</th><th>Cloud save</th><th className="num">Planet / kota</th><th className="num">Waktu main</th><th>Terakhir</th><th /></tr></thead>
          <tbody>{data?.items.map((w) => {
            const owner = w.userId ? `u:${w.userId}` : w.deviceId ? `d:${w.deviceId}` : null;
            return (
              <tr key={`${w.worldId}:${w.deviceId}:${w.userId}`}>
                <td><strong>{w.seed ?? '—'}</strong><div className="mono muted">{w.worldId}</div></td>
                <td>{owner ? <Link to={`/admin/players/${encodeURIComponent(owner)}`}>{w.email ?? `Anonim · ${shortId(w.deviceId ?? '')}`}</Link> : '—'}</td>
                <td>{w.rev ? `rev ${w.rev} · ${fmtBytes(w.size ?? 0)}` : <span className="muted">—</span>}</td>
                <td className="num">{w.meta ? `${w.meta.planetsLanded} / ${w.meta.townsVisited}` : '—'}</td>
                <td className="num">{w.meta ? fmtDuration(w.meta.playtimeSec) : '—'}</td>
                <td>{fmtAgo(w.lastSeen)}</td>
                <td className="num">{w.rev && w.userId ? <button type="button" className="pill pill--ghost pill--small" onClick={() => openInspect(token, w.userId!, w.worldId).catch((e) => setProblem(`Inspect gagal: ${(e as Error).message}`))}>Buka ↗</button> : null}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {data && !data.items.length ? <p className="empty">Belum ada dunia.</p> : null}
      </div>
      {data ? <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} /> : null}
    </section>
  );
}
