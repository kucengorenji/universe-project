import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth.tsx';
import { request } from '../api.ts';

/** GET on the API; keeps the previous data while a reload runs (no flash). */
export function useApi<T>(path: string | null) {
  const { token } = useAuth();
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await request<T>(token, path);
      if (mine === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, error: error as Error, loading: false }));
    }
  }, [path, token]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Two clicks instead of a browser dialog: the first arms, the second acts. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'pill pill--danger pill--small' }: { label: string; confirmLabel: string; onConfirm: () => Promise<void> | void; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button type="button" className={className} data-armed={armed || undefined} disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try { await onConfirm(); } finally { setBusy(false); setArmed(false); }
      }}>
      {armed ? confirmLabel : label}
    </button>
  );
}

export function StatTile({ label, value, note, hero = false }: { label: string; value: ReactNode; note?: ReactNode; hero?: boolean }) {
  return (
    <div className={`tile${hero ? ' tile--hero' : ''}`}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {note ? <span className="tile__note">{note}</span> : null}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: ReactNode }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter">
      <span className="small">{label}</span>
      <div className="meter__track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ErrorNotice({ error, retry, text }: { error: Error; retry?: () => void; text: string }) {
  return (
    <div className="notice notice--error" role="alert">
      {text} {error.message} {retry ? <button type="button" className="linkish" onClick={retry}>↻</button> : null}
    </div>
  );
}

export function Card({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card__head"><h3 className="card__title">{title}</h3>{aside}</header>
      <div className="card__body">{children}</div>
    </section>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="pager">
      <span>{offset + 1}–{Math.min(total, offset + limit)} dari {total}</span>
      <span className="pill-row">
        <button type="button" className="pill pill--ghost pill--small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>← Sebelumnya</button>
        <button type="button" className="pill pill--ghost pill--small" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Berikutnya →</button>
      </span>
    </div>
  );
}
