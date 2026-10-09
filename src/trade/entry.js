import { t } from '../i18n/index.js';
import { alerts } from './simulation.js';
import { prepareScenario } from './scenario.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function openTradeSetup(ctx, planet, map, { forceNew = false, forceDialog = false } = {}) {
  const { trade, director } = ctx;
  await trade.ready;
  if (!forceNew && !forceDialog && trade.state?.planet === planet && trade.state.worldId === ctx.world.worldId && trade.state.fingerprint === (await import('./resources.js')).fingerprint(map)) {
    await director.go({ mode: 'trade', planet, campaign: trade.state.id }); return;
  }
  if (document.querySelector('.trade-entry-dialog')) return;
  const release = trade.hold(), previousFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'trade-entry-dialog';
  const matches = trade.matching(planet, map), supported = map.planetType === 'terran';
  const archived = trade.items.filter(c => !matches.some(m => m.id === c.id));
  dialog.innerHTML = `<form method="dialog"><button class="trade-close" aria-label="${t('trade.cancel')}">×</button></form>
    <p class="trade-eyebrow">TRADE GAME / ${escape(ctx.world.planet(planet).name)}</p><h1>${t('trade.setup')}</h1>
    <p>${t('trade.setup.body')}</p><p class="trade-entry-rules">${t('trade.setup.rules')}</p>
    ${matches.length && !forceNew ? `<label>${t('trade.continue')}<select data-save>${matches.map(c => `<option value="${escape(c.id)}">${escape(c.name)} · ${escape(c.id.slice(-6))}</option>`).join('')}</select></label>` : ''}
    <label class="trade-checkbox"><input type="checkbox" data-tutorial checked> ${t('trade.tutorial')}</label>
    <p data-error role="alert">${supported ? trade.loadError ? t(trade.loadError) : forceNew ? t('trade.new.confirm') : '' : t('trade.error.planet')}</p>
    <div class="trade-entry-actions">${matches.length && !forceNew ? `<button class="trade-button primary" data-resume>${t('trade.continue')}</button>` : ''}
      <button class="trade-button ${matches.length && !forceNew ? '' : 'primary'}" data-start ${supported ? '' : 'disabled'}>${t(matches.length ? 'trade.new' : 'trade.start')}</button>
      <label class="trade-button">${t('trade.import')}<input data-import type="file" accept="application/json,.json" hidden></label></div>
    ${archived.length ? `<details><summary>${t('trade.archive')}</summary><p>${t('trade.archive.body')}</p>${archived.map(c => `<p>${escape(c.name)} · ${escape(c.seed ?? c.worldId)} <button class="trade-button" data-export-save="${escape(c.id)}">${t('trade.export')}</button></p>`).join('')}</details>` : ''}`;
  document.body.appendChild(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { release(); dialog.remove(); previousFocus?.focus?.({ preventScroll: true }); }, { once: true });
  const setBusy = busy => { dialog.querySelectorAll('button:not(.trade-close)').forEach(b => b.disabled = busy); };
  const navigate = async id => { trade.loadError = null; dialog.close(); await director.go({ mode: 'trade', planet, campaign: id }); };
  dialog.querySelectorAll('[data-export-save]').forEach(button => button.addEventListener('click', async () => {
    try { downloadTrade(await trade.exportSaved(button.dataset.exportSave), button.dataset.exportSave); }
    catch (error) { dialog.querySelector('[data-error]').textContent = t(error.message); }
  }));
  dialog.querySelector('[data-resume]')?.addEventListener('click', async () => {
    setBusy(true);
    try { const id = dialog.querySelector('[data-save]').value; await trade.resume(id); await navigate(id); }
    catch (error) { dialog.querySelector('[data-error]').textContent = t(error.message); setBusy(false); }
  });
  dialog.querySelector('[data-start]').addEventListener('click', async () => {
    setBusy(true); dialog.querySelector('[data-error]').textContent = t('trade.loading');
    try {
      const scenario = prepareScenario(map, ctx.world.hexasphere);
      if (!scenario.ok) throw new Error(`trade.error.${scenario.reason}`);
      const id = await trade.create(planet, map, dialog.querySelector('[data-tutorial]').checked); await navigate(id);
    } catch (error) { dialog.querySelector('[data-error]').textContent = t(error.message); setBusy(false); }
  });
  dialog.querySelector('[data-import]').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    setBusy(true);
    try { if (file.size > 12_000_000) throw new Error('trade.error.save'); const id = await trade.import(await file.text()); await navigate(id); }
    catch (error) { dialog.querySelector('[data-error]').textContent = t(error.message); setBusy(false); }
  });
}

export function downloadTrade(text, id) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = `trade-${id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountTradeEntry(mode) {
  const { ctx, index, map, ui } = mode;
  if (!ctx.trade) return () => {};
  const button = document.createElement('button'); button.className = 'trade-entry-cta'; button.type = 'button';
  button.addEventListener('click', () => openTradeSetup(ctx, index, map)); ui.appendChild(button);
  const update = () => {
    const active = ctx.trade.state?.planet === index && ctx.trade.state.worldId === ctx.world.worldId;
    const count = active ? alerts(ctx.trade.state).length : 0;
    button.textContent = `${t('trade.enter')}${active ? ` · ${t('trade.continue')}` : ''}${count ? ` (${count})` : ''}`;
    button.title = map.planetType !== 'terran' ? t('trade.error.planet') : t('trade.setup.body');
  };
  const unsubscribe = ctx.trade.subscribe(update); update(); ctx.trade.ready.then(update);
  return () => { unsubscribe(); button.remove(); };
}
