import type { AdminLogRow } from '../../../../shared/api.ts';
import { ErrorNotice, useApi } from '../../components/ui.tsx';
import { fmtDateTime } from '../../format.ts';

const ACTIONS: Record<string, string> = {
  'player.delete': 'Hapus pemain',
  'world.inspect': 'Buka dunia (inspect)',
  'announcement.create': 'Buat pengumuman',
  'announcement.update': 'Ubah pengumuman',
  'announcement.delete': 'Hapus pengumuman'
};

export function Log() {
  const { data, error, reload } = useApi<{ items: AdminLogRow[] }>('/admin/log?limit=200');
  if (error) return <ErrorNotice error={error} retry={reload} text="Gagal memuat log:" />;
  return (
    <section className="section">
      <p className="lead">Setiap tindakan admin yang mengubah atau membuka data pemain tercatat di sini.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Waktu</th><th>Admin</th><th>Tindakan</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>{data?.items.map((r) => (
            <tr key={r.id}><td>{fmtDateTime(r.at)}</td><td>{r.adminEmail}</td><td>{ACTIONS[r.action] ?? r.action}</td><td className="mono">{r.target}</td><td className="mono muted">{r.detail ?? ''}</td></tr>
          ))}</tbody>
        </table>
        {data && !data.items.length ? <p className="empty">Belum ada tindakan admin.</p> : null}
      </div>
    </section>
  );
}
