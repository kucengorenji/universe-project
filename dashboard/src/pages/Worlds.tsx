import { useState } from 'react';
import type { PlayerExport, WorldSave, WorldSummary } from '../../../shared/api.ts';
import { downloadJson, request } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ConfirmButton, ErrorNotice, Meter, useApi } from '../components/ui.tsx';
import { restoreUrl } from '../config.ts';
import { fmtAgo, fmtBytes, fmtDuration, fmtNumber, shortId } from '../format.ts';
import { useI18n } from '../i18n.tsx';
import { MISSIONS } from '../../../src/core/missionList.js';

function WorldCard({ world, onDeleted }: { world: WorldSummary; onDeleted: () => void }) {
  const { token } = useAuth();
  const { t, game, locale } = useI18n();
  const m = world.meta;
  const path = `/me/worlds/${encodeURIComponent(world.worldId)}`;
  return (
    <article className="world">
      <header className="world__head">
        <span className="eyebrow" style={{ color: 'inherit' }}>{t('worlds.seed')}</span>
        <h3 className="world__seed">{String(m.seed)}</h3>
        <p className="world__meta">{t('worlds.saved', { when: fmtAgo(world.updatedAt, locale) })} · {t('worlds.rev', { rev: world.rev })} · {fmtBytes(world.size)}</p>
      </header>
      <dl className="world__stats">
        <div><dt>{t('worlds.planets')}</dt><dd>{fmtNumber(m.planetsLanded, locale)}</dd></div>
        <div><dt>{t('worlds.towns')}</dt><dd>{fmtNumber(m.townsVisited, locale)}</dd></div>
        <div><dt>{t('worlds.playtime')}</dt><dd>{fmtDuration(m.playtimeSec, locale)}</dd></div>
        <div><dt>{t('worlds.homes')}</dt><dd>{fmtNumber(m.homes, locale)}</dd></div>
      </dl>
      <div className="world__missions">
        <Meter value={m.missionItems.done} max={m.missionItems.total} label={t('worlds.missionsDone', { done: m.missionItems.done, total: m.missionItems.total })} />
        {m.missionsDone.length ? (
          <p className="small muted" style={{ marginTop: 8 }}>✓ {m.missionsDone.map((id) => game(`mission.${id}.title`)).join(' · ')}</p>
        ) : null}
      </div>
      <div className="world__actions">
        <a className="pill pill--small" href={restoreUrl(world.worldId)}>{t('worlds.restore')}</a>
        <button type="button" className="pill pill--ghost pill--small" onClick={async () => {
          const save = await request<WorldSave>(token, path);
          downloadJson(save, `aethergate-world-${m.seed}.json`);
        }}>{t('worlds.download')}</button>
        <ConfirmButton label={t('worlds.delete')} confirmLabel={t('worlds.deleteConfirm')} onConfirm={async () => {
          await request(token, path, { method: 'DELETE' });
          onDeleted();
        }} />
      </div>
    </article>
  );
}

export function Worlds() {
  const { me, token, refresh, signOut, deleteFirebaseUser } = useAuth();
  const { t, locale } = useI18n();
  const worlds = useApi<{ items: WorldSummary[] }>('/me/worlds');
  const [deleted, setDeleted] = useState(false);
  const missionTotal = MISSIONS.reduce((n, m) => n + m.items.length, 0);

  if (deleted) return <div className="shell page"><p className="notice">{t('data.deleted')}</p></div>;
  return (
    <div className="shell page">
      <header className="section">
        <h1 className="page-title">{t('worlds.title')}</h1>
        <p className="lead">{t('worlds.lead')}</p>
      </header>

      {worlds.error ? <ErrorNotice error={worlds.error} retry={worlds.reload} text={t('common.error', { error: '' })} /> : null}
      {worlds.data === null && !worlds.error ? <p className="small muted">{t('common.loading')}</p> : null}
      {worlds.data?.items.length === 0 ? <p className="notice">{t('worlds.empty')}</p> : null}
      {worlds.data?.items.length ? (
        <div className="worlds">
          {worlds.data.items.map((w) => <WorldCard key={w.worldId} world={{ ...w, meta: { ...w.meta, missionItems: { ...w.meta.missionItems, total: w.meta.missionItems.total || missionTotal } } }} onDeleted={worlds.reload} />)}
        </div>
      ) : null}

      <section className="section">
        <h2 className="section-title">{t('devices.title')}</h2>
        <p className="lead">{t('devices.lead')}</p>
        {me?.devices.length ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {me.devices.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{shortId(d.id)}</td>
                    <td>{t('devices.lastSeen', { when: fmtAgo(d.lastSeenAt, locale) })}</td>
                    <td>{d.country ?? ''}</td>
                    <td className="num"><button type="button" className="pill pill--ghost pill--small" onClick={async () => {
                      await request(token, `/me/devices/${d.id}`, { method: 'DELETE' });
                      refresh();
                    }}>{t('devices.unlink')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">{t('devices.empty')}</p>}
      </section>

      <section className="section">
        <h2 className="section-title">{t('data.title')}</h2>
        <p className="lead">{t('data.lead')}</p>
        <div className="pill-row">
          <button type="button" className="pill pill--ghost" onClick={async () => downloadJson(await request<PlayerExport>(token, '/me/export'), 'aethergate-data.json')}>{t('data.export')}</button>
          <ConfirmButton className="pill pill--danger" label={t('data.delete')} confirmLabel={t('data.deleteConfirm')} onConfirm={async () => {
            await request(token, '/me', { method: 'DELETE' });
            await deleteFirebaseUser();
            setDeleted(true);
            await signOut();
          }} />
        </div>
      </section>
    </div>
  );
}
