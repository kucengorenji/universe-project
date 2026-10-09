import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Page, PlayerRow } from '../../../../shared/api.ts';
import { ErrorNotice, Pager, useApi } from '../../components/ui.tsx';
import { fmtAgo, fmtDateTime, shortId } from '../../format.ts';

const LIMIT = 50;

export function playerName(p: Pick<PlayerRow, 'key' | 'email' | 'name'>) {
  if (p.email) return p.email;
  return `Anonim · ${shortId(p.key.slice(2))}`;
}

export function Players() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<Page<PlayerRow>>(`/admin/players?limit=${LIMIT}&offset=${offset}&q=${encodeURIComponent(query)}`);
  return (
    <section className="section">
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q.trim()); }}>
        <label className="field" style={{ flex: '1 1 260px' }}>
          <span>Cari email, nama, atau ID perangkat</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="alice@…" />
        </label>
        <button type="submit" className="pill">Cari</button>
        <span className="small muted">{data ? `${data.total} pemain` : ''}{loading ? ' · memuat…' : ''}</span>
      </form>
      {error ? <ErrorNotice error={error} retry={reload} text="Gagal memuat pemain:" /> : null}
      <div className={`table-wrap${loading && data ? ' chart is-stale' : ''}`}>
        <table>
          <thead><tr><th>Pemain</th><th className="num">Perangkat</th><th>Pertama terlihat</th><th>Terakhir terlihat</th><th>Negara</th></tr></thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.key} className="link" tabIndex={0} onClick={() => navigate(`/admin/players/${encodeURIComponent(p.key)}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/players/${encodeURIComponent(p.key)}`); }}>
                <td>{playerName(p)}{p.name && p.email ? <div className="small muted">{p.name}</div> : null}</td>
                <td className="num">{p.devices}</td>
                <td>{fmtDateTime(p.firstSeen)}</td>
                <td>{fmtAgo(p.lastSeen)}</td>
                <td>{p.country ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length ? <p className="empty">Tidak ada pemain{query ? ` untuk “${query}”` : ''}.</p> : null}
      </div>
      {data ? <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} /> : null}
    </section>
  );
}
