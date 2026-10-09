import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { EventRow } from '../../../../shared/api.ts';
import { request } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import { ErrorNotice } from '../../components/ui.tsx';
import { fmtDateTime, shortId } from '../../format.ts';

const TYPES = ['', 'session_start', 'session_end', 'mode', 'mission', 'mission_done', 'world', 'error'];

export function EventTable({ events, showDevice = false }: { events: EventRow[]; showDevice?: boolean }) {
  if (!events.length) return <p className="small muted">Tidak ada event.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Waktu</th>{showDevice ? <th>Pemain</th> : null}<th>Tipe</th><th>Nama</th><th>Data</th></tr></thead>
        <tbody>{events.map((e) => (
          <tr key={e.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</td>
            {showDevice ? <td className="mono"><Link to={`/admin/players/${encodeURIComponent(e.userId ? `u:${e.userId}` : `d:${e.deviceId}`)}`}>{e.userId ? `u:${shortId(e.userId)}` : shortId(e.deviceId)}</Link></td> : null}
            <td><span className="badge">{e.type}</span></td>
            <td className="mono">{e.name ?? ''}{e.value != null ? ` = ${e.value}` : ''}</td>
            <td className="mono muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{e.data ? JSON.stringify(e.data) : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function Events() {
  const { token } = useAuth();
  const [type, setType] = useState('');
  const [device, setDevice] = useState('');
  const [items, setItems] = useState<EventRow[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (before: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, device: device.trim(), limit: '100', before: String(before) });
      const page = await request<{ items: EventRow[] }>(token, `/admin/events?${params}`);
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setDone(page.items.length < 100);
      setError(null);
    } catch (e) { setError(e as Error); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(0, false); }, [type]);

  return (
    <section className="section">
      <form className="filters" onSubmit={(e) => { e.preventDefault(); load(0, false); }}>
        <label className="field"><span>Tipe</span>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t || 'Semua'}</option>)}</select>
        </label>
        <label className="field" style={{ flex: '1 1 300px' }}><span>ID perangkat</span>
          <input className="input mono" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="opsional" />
        </label>
        <button type="submit" className="pill">Terapkan</button>
        <span className="small muted">Event mentah disimpan 90 hari.{loading ? ' Memuat…' : ''}</span>
      </form>
      {error ? <ErrorNotice error={error} text="Gagal memuat event:" /> : null}
      <div className={loading && items.length ? 'chart is-stale' : ''}><EventTable events={items} showDevice /></div>
      {!done && items.length ? <div><button type="button" className="pill pill--ghost" disabled={loading} onClick={() => load(items[items.length - 1].id, true)}>Muat lebih lama</button></div> : null}
    </section>
  );
}
