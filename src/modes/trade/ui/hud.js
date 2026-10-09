import { t, formatNumber, onLocaleChange } from '../../../i18n/index.js';
import { escape, openTradeSetup, downloadTrade } from '../../../trade/entry.js';
import { GOODS, ICONS, FACILITIES, MILESTONES, stockTotal } from '../../../trade/catalog.js';
import { owned, alerts, cashFlow, quote, routePreview, facilityStatus } from '../../../trade/simulation.js';
import { siteAccess } from '../../../trade/resources.js';
import { findPath } from '../../../trade/routing.js';

const money = n => `${formatNumber(n / 100, { maximumFractionDigits: 1 })} cr`;
const good = g => `${ICONS[g]} ${t(`trade.good.${g}`)}`;
const action = (name, label, data = '', disabled = false, primary = false) => `<button type="button" class="trade-button${primary ? ' primary' : ''}" data-action="${name}" ${data}${disabled ? ' disabled' : ''}>${label}</button>`;
const fact = (label, value) => `<div class="trade-fact"><span>${label}</span><strong>${value}</strong></div>`;
const recipe = values => Object.entries(values || {}).map(([g, n]) => `${n} ${t(`trade.good.${g}`)}`).join(' + ');

export class TradeHud {
  constructor(mode) {
    this.mode = mode; this.session = mode.session; this.page = 'inspect';
    this.selection = this.session.state.ui.selection || { type: 'city', id: this.session.state.cities[0].id };
    this.managing = owned(this.session.state)[0].id; this.lastRender = 0; this.draft = null;
    this.root = document.createElement('section'); this.root.className = 'trade-root';
    this.root.setAttribute('aria-label', t('trade.title'));
    this.root.innerHTML = `<header class="trade-topbar"><div class="trade-brand">${action('explore', '↖ ' + t('trade.explore'))}<div><small>TRADE GAME</small><strong>${escape(this.session.state.name)}</strong></div></div>
      <div class="trade-treasury"><div><span>${t('trade.cash')}</span><strong data-cash></strong></div><div><span>${t('trade.flow')}</span><strong data-flow></strong></div></div>
      <div class="trade-time">${action('play', t('trade.play'), '', false, true)}<div class="trade-speeds">${[1, 2, 4].map(n => action('speed', `${n}×`, `data-speed="${n}"`)).join('')}</div><span data-time></span>${action('settings', '⚙', `aria-label="${t('trade.settings')}"`)}</div></header>
      <nav class="trade-rail" aria-label="${t('trade.overview')}">${[['cities', '▦'], ['routes', '⇄'], ['contracts', '◇'], ['goals', '⚑'], ['alerts', '!']].map(([name, icon]) => action('page', `<b>${icon}</b><span>${t(`trade.${name}`)}</span>`, `data-page="${name}" title="${t(`trade.${name}`)}"`)).join('')}</nav>
      <aside class="trade-objective"><small>${t('trade.objective')}</small><strong data-goal></strong><p data-hint></p><div>${action('goalAction', t('trade.focus'))}${action('guidance', '−', `aria-label="${t('trade.skip')}"`)}</div></aside>
      <aside class="trade-inspector"><header><div><small data-panel-subtitle></small><h2 data-panel-title></h2></div>${action('overview', '↗', `title="${t('trade.overview')}"`)}</header><div class="trade-panel-body" data-panel></div></aside>
      <footer class="trade-dock"><div>${action('build', `${t('trade.build')} <kbd>B</kbd>`, '', false, true)}${action('newRoute', `${t('trade.routes')} <kbd>R</kbd>`)}${action('expand', t('trade.expand'))}</div><div class="trade-overlays">${['resources', 'supply', 'overview'].map(name => action('overlay', t(`trade.${name}`), `data-overlay="${name}"`)).join('')}</div><span data-save></span></footer>
      <div class="trade-message" role="status" aria-live="polite" hidden></div>`;
    document.body.appendChild(this.root);
    this.onClick = e => this.click(e); this.onChange = e => this.change(e);
    this.root.addEventListener('click', this.onClick); this.root.addEventListener('change', this.onChange); this.root.addEventListener('input', this.onChange);
    this.root.addEventListener('pointerdown', () => { this.interactionUntil = performance.now() + 500; });
    this.unsubscribeLocale = onLocaleChange(() => { this.localize(); this.render(true); });
  }
  localize() {
    this.root.setAttribute('aria-label', t('trade.title'));
    for (const b of this.root.querySelectorAll('.trade-rail [data-page]')) { b.querySelector('span').textContent = t(`trade.${b.dataset.page}`); b.title = t(`trade.${b.dataset.page}`); }
    this.root.querySelector('[data-action="explore"]').textContent = '↖ ' + t('trade.explore');
    this.root.querySelector('.trade-treasury > div:first-child span').textContent = t('trade.cash');
    this.root.querySelector('.trade-treasury > div:last-child span').textContent = t('trade.flow');
    this.root.querySelector('.trade-objective > small').textContent = t('trade.objective');
    this.root.querySelector('[data-action="goalAction"]').textContent = t('trade.focus');
    for (const [a, key] of [['build', 'build'], ['newRoute', 'routes'], ['expand', 'expand']]) {
      const b = this.root.querySelector(`.trade-dock [data-action="${a}"]`), kbd = b.querySelector('kbd');
      b.textContent = t(`trade.${key}`) + ' '; if (kbd) b.appendChild(kbd);
    }
    for (const b of this.root.querySelectorAll('[data-overlay]')) b.textContent = t(`trade.${b.dataset.overlay}`);
  }
  title(title, subtitle = '') { this.root.querySelector('[data-panel-title]').textContent = title; this.root.querySelector('[data-panel-subtitle]').textContent = subtitle; }
  townSelect(name, selected, list = owned(this.session.state)) { return `<label>${t('trade.choose.city')}<select data-field="${name}">${list.map(c => `<option value="${escape(c.id)}"${c.id === selected ? ' selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label>`; }
  stock(city) { return `<div class="trade-stock">${GOODS.map(g => `<div><span>${good(g)}</span><strong>${formatNumber(city.stock[g])}</strong></div>`).join('')}</div>`; }
  rows(items) { return items.length ? `<div class="trade-list">${items.join('')}</div>` : `<p class="trade-empty">${t('trade.nothing')}</p>`; }
  row(type, id, title, description, trailing = '') { return `<button class="trade-row" data-action="inspect" data-type="${type}" data-id="${escape(id)}"><span><strong>${escape(title)}</strong><small>${escape(description)}</small></span><b>${trailing}</b></button>`; }
  render(force = false) {
    const now = performance.now(), s = this.session.state;
    if (!force && now - this.lastRender < 250) return;
    this.lastRender = now;
    this.root.querySelector('[data-cash]').textContent = money(s.cash);
    const flow = this.root.querySelector('[data-flow]'); flow.textContent = money(cashFlow(s)); flow.dataset.negative = cashFlow(s) < 0;
    const play = this.root.querySelector('[data-action="play"]'); play.textContent = t(s.paused ? 'trade.play' : 'trade.pause'); play.setAttribute('aria-pressed', String(!s.paused)); play.disabled = this.session.readOnly;
    for (const b of this.root.querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s.speed));
    for (const b of this.root.querySelectorAll('.trade-rail [data-page]')) b.setAttribute('aria-pressed', String(b.dataset.page === this.page));
    for (const b of this.root.querySelectorAll('[data-overlay]')) b.setAttribute('aria-pressed', String(b.dataset.overlay === this.mode.view.overlay));
    this.root.querySelector('[data-time]').textContent = `${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')}`;
    this.root.querySelector('[data-save]').textContent = t(this.session.readOnly ? 'trade.readonly' : this.session.saveError ? 'trade.unsaved' : this.session.accumulator >= 1 ? 'trade.catchup' : 'trade.saved');
    const milestone = MILESTONES.find(m => !s.milestones.includes(m));
    this.root.querySelector('[data-goal]').textContent = t(milestone ? `trade.goal.${milestone}` : 'trade.completed');
    this.root.querySelector('[data-hint]').textContent = t(milestone ? `trade.hint.${milestone}` : 'trade.completed.body');
    this.root.querySelector('[data-hint]').hidden = !s.tutorial;
    this.root.querySelector('[data-action="expand"]').disabled = !s.milestones.includes('network') || this.session.readOnly;
    if (!force && (now < (this.interactionUntil || 0) || ['configure', 'placement', 'catalog', 'settings'].includes(this.page) || this.root.contains(document.activeElement) && document.activeElement.matches('input, select'))) return;
    this.renderPanel();
  }
  renderPanel() {
    const s = this.session.state, body = this.root.querySelector('[data-panel]'); let html = '';
    this.title(t(`trade.${this.page}`), 'TRADE GAME');
    if (this.session.readOnly) { this.title(t('trade.title')); html = `<p>${t('trade.readonly')}</p>${action('takeover', t('trade.takeover'))}`; }
    else if (this.page === 'cities' || this.page === 'origin' || this.page === 'destination') {
      this.title(t(this.page === 'cities' ? 'trade.cities' : `trade.route.select.${this.page === 'origin' ? 'from' : 'to'}`));
      html = this.rows(s.cities.filter(c => this.page !== 'destination' || c.id !== this.draft.from).map(c => {
        const meta = `${t(c.owner === 'player' ? 'trade.own' : 'trade.npc')} · ${Math.round(c.service * 100)}% ${t('trade.service')}`;
        return this.page === 'cities' ? this.row('city', c.id, c.name, meta, `${c.tier}`) : `<button class="trade-row" data-action="pickTown" data-id="${escape(c.id)}"><span><strong>${escape(c.name)}</strong><small>${meta}</small></span>→</button>`;
      }));
    } else if (this.page === 'routes') {
      html = action('newRoute', '+ ' + t('trade.create.route'), '', false, true) + this.rows(s.routes.map(r => this.row('route', r.id,
        `${this.city(r.from).name} → ${this.city(r.to).name}`, `${t(`trade.good.${r.good}`)} · ${r.vehicles} ${t('trade.vehicles')}`, `${r.delivered}`)));
    } else if (this.page === 'catalog') {
      this.title(t('trade.build')); const city = this.city(this.managing);
      html = this.townSelect('managing', this.managing) + `<div class="trade-catalog">${Object.entries(FACILITIES).map(([kind, spec]) => {
        const locked = ['port', 'workshop'].includes(kind) && !s.milestones.includes('network');
        const missing = Object.entries(spec.materials).some(([g, n]) => city.stock[g] < n);
        const disabled = locked || missing || s.cash < spec.cost;
        const functionText = spec.output ? `${recipe(spec.input)}${spec.input ? ' → ' : ''}${recipe(spec.output)} / ${spec.cycle}s` : spec.capacity ? `+${spec.capacity} ${t('trade.capacity')}` : t(`trade.facility.${kind}`);
        return `<button class="trade-catalog-item" data-action="chooseBuild" data-kind="${kind}" ${disabled ? 'disabled' : ''}><strong>${t(`trade.facility.${kind}`)}</strong><small>${functionText}</small><span>${money(spec.cost)} + ${recipe(spec.materials)}</span>${disabled ? `<em>${t(locked ? 'trade.error.locked' : missing ? 'trade.error.materials' : 'trade.error.cash')}</em>` : ''}</button>`;
      }).join('')}</div>`;
    } else if (this.page === 'placement') {
      const tool = this.mode.tool;
      if (!tool) { this.page = 'inspect'; this.renderPanel(); return; }
      this.title(t(tool.kind === 'city' ? 'trade.expand' : `trade.facility.${tool.kind}`), this.city(tool.cityId).name);
      const spec = FACILITIES[tool.kind];
      html = `<p>${t(tool.kind === 'city' ? 'trade.placement.city' : 'trade.placement')}</p>${spec ? fact(t('trade.cost'), money(spec.cost) + '<br>' + recipe(spec.materials)) + fact(t('trade.upkeep'), money(spec.upkeep)) : `<p>${t('trade.city.cost')}</p>`}
        <p class="trade-location-hint" data-placement>${this.mode.validTiles.length} ${t('trade.available')}</p>${action('cancel', t('trade.cancel'))}`;
    } else if (this.page === 'configure') {
      this.title(t('trade.route.details'), `${this.city(this.draft.from).name} → ${this.city(this.draft.to).name}`);
      const options = selected => GOODS.map(g => `<option value="${g}"${selected === g ? ' selected' : ''}>${t(`trade.good.${g}`)}</option>`).join('');
      html = `<label>${t('trade.transport')}<select data-field="mode"${this.editing ? ' disabled' : ''}><option value="land"${this.draft.mode === 'land' ? ' selected' : ''}>${t('trade.land')}</option><option value="sea"${this.draft.mode === 'sea' ? ' selected' : ''}>${t('trade.sea')}</option></select></label>
        <label>${t('trade.cargo')}<select data-field="good">${options(this.draft.good)}</select></label>
        <label>${t('trade.return')}<select data-field="back"><option value="">${t('trade.empty')}</option>${options(this.draft.back)}</select></label>
        <div class="trade-form-row"><label>${t('trade.vehicles')}<input type="number" data-field="vehicles" min="1" max="8" value="${this.draft.vehicles}"${this.editing ? ' disabled' : ''}></label>
        <label>${t('trade.reserve')}<input type="number" data-field="reserve" min="0" max="9999" value="${this.draft.reserve}"></label></div><small>${t('trade.reserve.help')}</small>
        <label>${t('trade.priority')}<select data-field="priority">${[1, 2, 3].map(n => `<option value="${n}"${(this.draft.priority ?? 2) === n ? ' selected' : ''}>${t(`trade.priority.${n}`)}</option>`).join('')}</select></label>
        <div data-preview></div><div class="trade-form-actions">${action('activateRoute', t(this.editing ? 'trade.confirm' : 'trade.create.route'), '', false, true)}${action('cancel', t('trade.cancel'))}</div>`;
    } else if (this.page === 'contracts') {
      html = this.rows(s.contracts.slice().reverse().map(c => `<article class="trade-contract"><strong>${t(`trade.status.${c.status}`)}</strong><p>${t('trade.contract.body', { quantity: c.quantity, good: t(`trade.good.${c.good}`), city: this.city(c.cityId).name, reward: money(c.reward) })}</p>
        <progress value="${c.delivered}" max="${c.quantity}"></progress><small>${c.delivered}/${c.quantity} ${c.status === 'active' ? '· ' + t('trade.contract.deadline', { seconds: Math.max(0, c.deadline - s.time) }) : ''}</small>
        ${c.status === 'offer' ? `<p>${t('trade.contract.feasibility')}</p>${action('accept', t('trade.accept'), `data-id="${c.id}"`, false, true)}${action('decline', t('trade.decline'), `data-id="${c.id}"`)}` : ''}</article>`));
    } else if (this.page === 'goals') {
      html = this.rows(MILESTONES.map(m => `<div class="trade-milestone"><b>${s.milestones.includes(m) ? '✓' : '○'}</b><div><strong>${t(`trade.goal.${m}`)}</strong><p>${t(`trade.hint.${m}`)}</p></div></div>`));
    } else if (this.page === 'alerts') {
      if (s.event) html += `<p class="trade-diagnosis">${t(`trade.event.${s.event.kind}`)} ${Math.max(0, s.event.until - s.time)}s</p>`;
      html += this.rows(alerts(s).map(a => this.row(a.type, a.id, t(`trade.status.${a.reason}`), this.entityName(a.type, a.id), '→')));
      if (s.cash < 15000 && !s.helpUsed) html += action('help', t('trade.help'));
    } else if (this.page === 'settings') {
      this.title(t('trade.settings'));
      html = `<h3>${t('trade.backup')}</h3>${action('export', t('trade.export'))}${action('newGame', t('trade.new'))}<p>${t('trade.new.confirm')}</p>${action('appSettings', t('trade.settings'))}${action('guidance', t(s.tutorial ? 'trade.skip' : 'trade.guidance'))}`;
    } else html = this.inspector();
    const scroll = body.scrollTop;
    if (body.innerHTML !== html) body.innerHTML = html;
    body.scrollTop = scroll;
    if (this.page === 'configure') this.preview();
  }
  city(id) { return this.session.state.cities.find(c => c.id === id); }
  entityName(type, id) { const s = this.session.state; return type === 'city' ? this.city(id)?.name || '' : type === 'facility' ? t(`trade.facility.${s.facilities.find(f => f.id === id)?.kind}`) : type === 'route' ? t('trade.routes') : ''; }
  inspector() {
    const s = this.session.state, { type, id } = this.selection;
    if (type === 'city') {
      const c = this.city(id); if (!c) return t('trade.select');
      this.title(c.name, t(c.owner === 'player' ? 'trade.own' : 'trade.npc'));
      const facilities = s.facilities.filter(f => f.cityId === c.id);
      return fact(t('trade.tier', { level: c.tier }), `${Math.round(c.service * 100)}% ${t('trade.service')}`) +
        (c.founding ? `<p class="trade-diagnosis">${t('trade.city.founding', { seconds: Math.ceil(c.founding) })}</p>` : '') +
        `<h3>${t('trade.stock')} <small>${stockTotal(c.stock)}/${c.capacity}</small></h3>${this.stock(c)}` +
        (c.owner === 'npc' ? `<h3>${t('trade.buy')}</h3>${['bread', 'wood', 'tools'].map(g => fact(good(g), money(quote(s, c, g)))).join('')}` : '') +
        `<div class="trade-actions">${c.owner === 'player' ? action('build', t('trade.build'), `data-city="${id}"`, !!c.founding, true) : ''}${action('newRoute', t('trade.create.route'), `data-city="${id}"`)}</div>` +
        (c.owner === 'player' ? `${action('upgradeCity', t('trade.city.upgrade'), `data-id="${id}"`, c.service < .8 || c.tier >= 3)}<h3>${t('trade.production')}</h3>${this.rows(facilities.map(f => this.row('facility', f.id, t(`trade.facility.${f.kind}`), t(`trade.status.${facilityStatus(s, f)}`))))}` : '') +
        `<h3>${t('trade.routes')}</h3>${this.rows(s.routes.filter(r => [r.from, r.to].includes(id)).map(r => this.row('route', r.id, `${this.city(r.from).name} → ${this.city(r.to).name}`, t(`trade.good.${r.good}`))))}` +
        (c.service < .8 && c.owner === 'player' ? `<div class="trade-diagnosis">${t('trade.fix.food')}</div>` : '');
    }
    if (type === 'facility') {
      const f = s.facilities.find(f => f.id === id); if (!f) return t('trade.select'); const spec = FACILITIES[f.kind], status = facilityStatus(s, f);
      this.title(t(`trade.facility.${f.kind}`), this.city(f.cityId).name);
      return fact(t('trade.production'), t(`trade.status.${status}`)) + (f.construction ? fact(t('trade.status.construction'), `${f.construction}s`) : '') +
        fact(t('trade.input'), recipe(spec.input) || '—') + fact(t('trade.output'), recipe(spec.output) || '—') + fact(t('trade.upkeep'), money(spec.upkeep * f.level)) +
        fact(t('trade.buffer'), String(stockTotal(f.buffer))) + fact(t('trade.tier', { level: f.level }), `${spec.cycle || '—'}s`) +
        (['input', 'capacity', 'cash'].includes(status) ? `<p class="trade-diagnosis">${t(`trade.fix.${status}`)}</p>` : '') +
        `<div class="trade-actions">${action('toggleFacility', t(f.active ? 'trade.pause' : 'trade.play'), `data-id="${id}"`)}${action('upgradeFacility', t('trade.upgrade'), `data-id="${id}"`, !!f.construction || f.level >= 3)}${f.id === 'starter-farm' ? '' : action('demolish', t('trade.demolish'), `data-id="${id}"`)}</div>`;
    }
    if (type === 'tile') {
      const site = siteAccess(this.session.graph, this.session.base.resourcePlan, Number(id));
      this.title(`${t('trade.resources')} · ${id}`, this.session.graph.tiles[id].biome);
      return ['fertility', 'wood', 'stone', 'ore', 'coast'].map(key => fact(t(`trade.resource.${key}`), key === 'fertility' ? `${Math.round(site[key] * 100)}%` : t(site[key] ? 'trade.available' : 'trade.unavailable'))).join('') + action('build', t('trade.build'), '', false, true);
    }
    if (type === 'route') {
      const r = s.routes.find(r => r.id === id); if (!r) return t('trade.select');
      this.title(t('trade.route.details'), `${this.city(r.from).name} → ${this.city(r.to).name}`);
      return fact(t('trade.cargo'), good(r.good)) + fact(t('trade.return'), r.back ? good(r.back) : t('trade.empty')) +
        fact(t('trade.vehicles'), r.vehicles) + fact(t('trade.delivered'), r.delivered) + fact(t('trade.revenue'), money(r.revenue)) + fact(t('trade.expenses'), money(r.expenses)) +
        (r.waiting ? `<div class="trade-diagnosis"><strong>${t(`trade.status.${r.waiting}`)}</strong><p>${t(`trade.fix.${r.waiting}`)}</p></div>` : '') +
        `<div class="trade-actions">${action('toggleRoute', t(r.active ? 'trade.pause' : 'trade.play'), `data-id="${id}"`)}${action('addVehicle', t('trade.add.vehicle'), `data-id="${id}"`)}${action('upgradeRoute', t('trade.upgrade'), `data-id="${id}"`, r.level >= 3)}${action('editRoute', t('trade.edit.route'), `data-id="${id}"`)}${action('removeRoute', t('trade.close.route'), `data-id="${id}"`)}</div>` +
        this.rows(s.shipments.filter(sh => sh.routeId === id).map(sh => this.row('shipment', sh.id, sh.quantity ? `${sh.quantity} ${t(`trade.good.${sh.good}`)}` : t('trade.empty'), sh.arrived && !sh.reverse ? t('trade.status.queue') : t('trade.arrival', { seconds: Math.max(0, Math.ceil(sh.seconds - sh.elapsed)) }))));
    }
    if (type === 'shipment') {
      const sh = s.shipments.find(sh => sh.id === id); if (!sh) return `<p>${t('trade.status.complete')}</p>${action('page', t('trade.routes'), 'data-page="routes"')}`;
      this.title(t('trade.shipment'), `${this.city(sh.from).name} → ${this.city(sh.to).name}`);
      return fact(t('trade.cargo'), sh.quantity ? `${sh.quantity} ${good(sh.good)}` : t('trade.empty')) + fact(t('trade.revenue'), money(sh.sell)) +
        `<progress value="${sh.elapsed}" max="${sh.seconds}"></progress><p>${t('trade.arrival', { seconds: Math.max(0, Math.ceil(sh.seconds - sh.elapsed)) })}</p>${action('follow', t('trade.follow'), `data-id="${id}"`)}${action('stopFollow', t('trade.stop.follow'))}`;
    }
    return `<p>${t('trade.select')}</p>`;
  }
  message(text) { const el = this.root.querySelector('.trade-message'); el.textContent = text; el.hidden = !text; clearTimeout(this.messageTimer); if (text) this.messageTimer = setTimeout(() => { el.hidden = true; }, 6500); }
  buildSummary(kind, cityId, tileId) {
    if (kind === 'city') return t('trade.city.cost');
    const spec = FACILITIES[kind], path = findPath(this.session.graph, tileId, this.city(cityId).tileId);
    return `${t('trade.cost')}: ${money(spec.cost + Math.max(0, (path?.length || 1) - 1) * 250)} · ${recipe(spec.materials)} · ${t('trade.connector')}: ${Math.max(0, (path?.length || 1) - 1)}`;
  }
  placementInfo(tile, valid) { const el = this.root.querySelector('[data-placement]'); if (el && tile) el.textContent = `${t(valid ? 'trade.placement.ready' : 'trade.placement.invalid')} · ${tile.id}${valid ? ' · ' + this.buildSummary(this.mode.tool.kind, this.mode.tool.cityId, tile.id) : ''}`; }
  confirm(title, description, callback) {
    if (this.dialog) return;
    const release = this.session.hold(), previousFocus = document.activeElement;
    const dialog = document.createElement('dialog'); this.dialog = dialog; dialog.className = 'trade-entry-dialog';
    dialog.innerHTML = `<h1>${escape(title)}</h1><p>${escape(description)}</p><div class="trade-entry-actions">${action('confirm', t('trade.confirm'), '', false, true)}${action('cancel', t('trade.cancel'))}</div>`;
    document.body.appendChild(dialog); dialog.showModal();
    dialog.querySelector('[data-action="confirm"]').onclick = () => { dialog.close(); callback(); };
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { release(); dialog.remove(); this.dialog = null; previousFocus?.focus?.({ preventScroll: true }); }, { once: true });
  }
  showCatalog(cityId) { this.mode.cancelTool(false); this.managing = cityId || (this.selection.type === 'city' && this.city(this.selection.id)?.owner === 'player' ? this.selection.id : this.managing); this.page = 'catalog'; this.render(true); }
  startRoute(cityId) {
    this.mode.cancelTool(false); this.editing = null;
    this.draft = { from: '', to: '', mode: 'land', good: 'bread', back: '', vehicles: 1, reserve: 4, priority: 2 };
    if (cityId && this.city(cityId)?.owner === 'npc') { this.draft.from = owned(this.session.state)[0].id; this.draft.to = cityId; this.page = 'configure'; }
    else { this.page = 'origin'; this.mode.tool = { type: 'origin' }; }
    this.render(true);
  }
  pickTown(id) { if (this.page === 'origin') { this.draft.from = id; this.page = 'destination'; this.mode.tool = { type: 'destination' }; } else { this.draft.to = id; this.page = 'configure'; this.mode.tool = null; } this.render(true); }
  preview() {
    const el = this.root.querySelector('[data-preview]'); if (!el) return;
    const button = this.root.querySelector('[data-action="activateRoute"]');
    try {
      const p = routePreview(this.session.state, this.session.graph, { ...this.draft, editing: this.editing });
      this.mode.view.previewPath(p.path, this.draft.mode === 'sea');
      const units = p.capacity * this.draft.vehicles * 60 / (p.seconds * 2), operation = this.draft.mode === 'sea' ? 240 : 120;
      const contribution = (p.sell - p.buy + p.backSell - p.backBuy) * p.capacity - operation;
      el.innerHTML = fact(t('trade.trip'), `${Math.round(p.seconds)}s`) + fact(t('trade.throughput'), `${p.capacity}`) +
        fact(t('trade.units.minute'), formatNumber(units, { maximumFractionDigits: 1 })) +
        (!this.editing ? fact(t('trade.connector'), money(p.connectionCost)) + fact(t('trade.vehicles'), money(p.vehicleCost)) + fact(t('trade.cost'), money(p.cost)) : '') +
        fact(t('trade.price'), money(p.sell)) + (p.buy ? fact(t('trade.purchase.price'), money(p.buy)) : '') +
        (p.backBuy ? fact(t('trade.return.price'), money(p.backBuy)) : '') + fact(t('trade.margin'), money(contribution)) + `<p class="trade-muted">${t('trade.estimate')}</p>`;
      button.disabled = !this.editing && p.cost > this.session.state.cash;
    } catch (error) { this.mode.view.clearPreview(); el.textContent = t(error.message); button.disabled = true; }
  }
  change(e) {
    const field = e.target.dataset.field; if (!field) return;
    if (field === 'managing') { this.managing = e.target.value; this.render(true); }
    else if (this.draft) { this.draft[field] = ['vehicles', 'reserve', 'priority'].includes(field) ? Number(e.target.value) : e.target.value; this.preview(); }
  }
  click(e) {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    const a = b.dataset.action, s = this.session.state, mode = this.mode;
    if (a === 'explore') this.mode.ctx.director.go({ mode: 'planet', planet: s.planet, city: null });
    else if (a === 'play') this.session.setPaused(!s.paused);
    else if (a === 'speed') this.session.setSpeed(Number(b.dataset.speed));
    else if (a === 'page') { mode.cancelTool(false); this.page = b.dataset.page; this.render(true); }
    else if (a === 'inspect') mode.inspect(b.dataset.type, b.dataset.id);
    else if (a === 'build') this.showCatalog(b.dataset.city);
    else if (a === 'chooseBuild') mode.startBuild(b.dataset.kind, this.managing);
    else if (a === 'expand') mode.startBuild('city', this.managing);
    else if (a === 'cancel') mode.cancelTool();
    else if (a === 'newRoute') this.startRoute(b.dataset.city);
    else if (a === 'pickTown') this.pickTown(b.dataset.id);
    else if (a === 'activateRoute') mode.perform(this.editing ? { type: 'editRoute', id: this.editing, ...this.draft } : { type: 'route', ...this.draft }, () => { mode.tool = null; mode.inspect('route', this.editing || s.routes.at(-1).id, false); });
    else if (a === 'editRoute') { const r = s.routes.find(r => r.id === b.dataset.id); this.draft = { from: r.from, to: r.to, good: r.good, back: r.back, mode: r.mode, vehicles: r.vehicles, reserve: r.reserve, priority: r.priority ?? 2 }; this.editing = r.id; this.page = 'configure'; this.render(true); }
    else if (a === 'overview' || a === 'stopFollow') { mode.view.following = null; mode.pr.controls.enabled = true; mode.pr.clearFocus({ animate: false }); }
    else if (a === 'overlay') { mode.view.showOverlay(b.dataset.overlay); if (b.dataset.overlay === 'supply') { this.page = 'alerts'; this.render(true); } else if (b.dataset.overlay === 'overview') { mode.view.following = null; mode.pr.controls.enabled = true; mode.pr.clearFocus({ animate: false }); } }
    else if (a === 'guidance') { s.tutorial = !s.tutorial; this.session.save(); this.render(true); }
    else if (a === 'goalAction') { const next = MILESTONES.find(m => !s.milestones.includes(m)); if (next === 'production') this.showCatalog(); else if (next === 'trade' || next === 'network') this.startRoute(); else if (next === 'city') mode.startBuild('city', this.managing); else { this.page = 'goals'; this.render(true); } }
    else if (a === 'follow') { mode.view.following = b.dataset.id; mode.pr.controls.enabled = false; mode.pr.camTween = null; }
    else if (a === 'settings') { mode.cancelTool(false); this.page = 'settings'; this.render(true); }
    else if (a === 'appSettings') mode.ctx.engine.pauseMenu.show();
    else if (a === 'newGame') openTradeSetup(mode.ctx, s.planet, mode.ctx.world.mapFor(s.planet), { forceNew: true });
    else if (a === 'export') downloadTrade(this.session.export(), s.id);
    else if (a === 'takeover') this.session.takeover().then(() => this.render(true)).catch(error => this.message(t(error.message)));
    else {
      const types = { upgradeCity: 'upgradeCity', toggleFacility: 'toggleFacility', upgradeFacility: 'upgradeFacility', demolish: 'demolish', toggleRoute: 'toggleRoute', addVehicle: 'routeVehicles', upgradeRoute: 'upgradeRoute', removeRoute: 'removeRoute', accept: 'contract', decline: 'decline', help: 'help' };
      if (types[a]) {
        const perform = () => mode.perform({ type: types[a], id: b.dataset.id }, () => { if (['demolish', 'removeRoute'].includes(a)) { this.page = a === 'demolish' ? 'cities' : 'routes'; } });
        if (['demolish', 'removeRoute'].includes(a)) {
          const f = s.facilities.find(f => f.id === b.dataset.id), r = s.routes.find(r => r.id === b.dataset.id);
          const refund = a === 'demolish' ? FACILITIES[f.kind].cost * (f.construction ? .75 : .4) : r.vehicles * (r.mode === 'sea' ? 16000 : 8000) * .4;
          this.confirm(t(a === 'demolish' ? 'trade.demolish' : 'trade.close.route'), t('trade.refund.confirm', { refund: money(Math.round(refund)) }) + (f?.construction ? ' ' + t('trade.refund.materials') : ''), perform);
        } else perform();
      }
    }
    this.render(true);
  }
  destroy() { this.dialog?.close(); clearTimeout(this.messageTimer); this.unsubscribeLocale(); this.root.remove(); }
}
