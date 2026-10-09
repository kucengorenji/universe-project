import { useState, type FormEvent } from 'react';
import type { Announcement, AnnouncementInput, Surface } from '../../../../shared/api.ts';
import { ApiError, request } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import { Card, ConfirmButton, ErrorNotice, useApi } from '../../components/ui.tsx';
import { fmtDateTime } from '../../format.ts';

const SURFACE_LABEL: Record<Surface, string> = { game: 'Game', landing: 'Landing' };

// <input type="datetime-local"> works in local time without a zone.
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() : null);

function status(a: Announcement, now = Date.now()) {
  if (a.startsAt > now) return { label: 'Terjadwal', className: 'badge' };
  if (a.endsAt !== null && a.endsAt <= now) return { label: 'Berakhir', className: 'badge' };
  return { label: 'Tayang', className: 'badge badge--live' };
}

const blank = (): AnnouncementInput => ({ level: 'info', surfaces: ['game', 'landing'], title: { id: '', en: '' }, body: { id: '', en: '' }, startsAt: Date.now(), endsAt: null });

function Editor({ initial, onSave, onCancel }: { initial: AnnouncementInput; onSave: (a: AnnouncementInput) => Promise<void>; onCancel?: () => void }) {
  const [a, setA] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof AnnouncementInput>(k: K, v: AnnouncementInput[K]) => setA((x) => ({ ...x, [k]: v }));
  const toggle = (s: Surface) => set('surfaces', a.surfaces.includes(s) ? a.surfaces.filter((x) => x !== s) : [...a.surfaces, s]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await onSave(a); setErr(null); }
    catch (error) { setErr(error instanceof ApiError ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return (
    <form className="section" onSubmit={submit}>
      <div className="filters">
        <div className="field"><span>Tingkat</span>
          <div className="seg">{(['info', 'important'] as const).map((l) => <button key={l} type="button" aria-pressed={a.level === l} onClick={() => set('level', l)}>{l === 'info' ? 'Info' : 'Penting'}</button>)}</div>
        </div>
        <div className="field"><span>Tampil di</span>
          <div className="pill-row">{(['game', 'landing'] as const).map((s) => <label key={s} className="check"><input type="checkbox" checked={a.surfaces.includes(s)} onChange={() => toggle(s)} />{SURFACE_LABEL[s]}</label>)}</div>
        </div>
        <label className="field"><span>Mulai</span><input className="input" type="datetime-local" required value={toLocalInput(a.startsAt)} onChange={(e) => set('startsAt', fromLocalInput(e.target.value) ?? Date.now())} /></label>
        <label className="field"><span>Selesai (opsional)</span><input className="input" type="datetime-local" value={a.endsAt ? toLocalInput(a.endsAt) : ''} onChange={(e) => set('endsAt', fromLocalInput(e.target.value))} /></label>
      </div>
      <div className="grid-2">
        {(['id', 'en'] as const).map((lang) => (
          <div key={lang} className="section" style={{ gap: 10 }}>
            <label className="field"><span>Judul ({lang === 'id' ? 'Indonesia' : 'English'})</span><input className="input" maxLength={120} value={a.title[lang]} onChange={(e) => set('title', { ...a.title, [lang]: e.target.value })} /></label>
            <label className="field"><span>Isi ({lang === 'id' ? 'Indonesia' : 'English'})</span><textarea className="input" maxLength={1000} value={a.body[lang]} onChange={(e) => set('body', { ...a.body, [lang]: e.target.value })} /></label>
          </div>
        ))}
      </div>
      <p className="small muted">Bahasa yang kosong memakai bahasa lainnya. Tiap pemain melihat satu pengumuman sekali; landing dan game berbagi status “sudah dilihat”.</p>
      {err ? <p className="notice notice--error" role="alert">{err}</p> : null}
      <div className="pill-row">
        <button type="submit" className="pill" disabled={busy}>Simpan</button>
        {onCancel ? <button type="button" className="pill pill--ghost" onClick={onCancel}>Batal</button> : null}
      </div>
    </form>
  );
}

export function Announcements() {
  const { token } = useAuth();
  const { data, error, reload } = useApi<{ items: Announcement[] }>('/admin/announcements');
  const [editing, setEditing] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <Card title="Pengumuman baru">
        <Editor key={formKey} initial={blank()} onSave={async (a) => {
          await request(token, '/admin/announcements', { method: 'POST', body: a });
          setFormKey((k) => k + 1);
          reload();
        }} />
      </Card>
      {error ? <ErrorNotice error={error} retry={reload} text="Gagal memuat pengumuman:" /> : null}
      <section className="section">
        <h2 className="section-title">Semua pengumuman</h2>
        {data && !data.items.length ? <p className="small muted">Belum ada pengumuman.</p> : null}
        {data?.items.map((a) => {
          const s = status(a);
          return (
            <Card key={a.id} title={a.title.id || a.title.en} aside={<span className="pill-row"><span className={s.className}>{s.label}</span>{a.level === 'important' ? <span className="badge badge--important">Penting</span> : null}</span>}>
              {editing === a.id ? (
                <Editor initial={a} onCancel={() => setEditing(null)} onSave={async (next) => {
                  await request(token, `/admin/announcements/${a.id}`, { method: 'PUT', body: next });
                  setEditing(null);
                  reload();
                }} />
              ) : (
                <div className="section" style={{ gap: 10 }}>
                  <p className="small">{a.body.id || a.body.en}</p>
                  <p className="small muted">{a.surfaces.map((x) => SURFACE_LABEL[x]).join(' + ')} · {fmtDateTime(a.startsAt)} → {a.endsAt ? fmtDateTime(a.endsAt) : 'tanpa batas'}</p>
                  <div className="pill-row">
                    <button type="button" className="pill pill--ghost pill--small" onClick={() => setEditing(a.id)}>Ubah</button>
                    <ConfirmButton label="Hapus" confirmLabel="Yakin? Klik lagi" onConfirm={async () => { await request(token, `/admin/announcements/${a.id}`, { method: 'DELETE' }); reload(); }} />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </section>
    </>
  );
}
