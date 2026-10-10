import './valley.css';
import { Engine } from '../core/engine.js';
import PALETTE from './valleyPalette.json';

// farm.html: the valley art slice (docs/FARM_PLAN.md), separate from the universe game.
// V0 is the look-dev scene: kit, painted ground, grass, times of day and the 3/4 camera.

window.addEventListener('DOMContentLoaded', async () => {
  const engine = new Engine(document.getElementById('stage'));
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const { ValleyLookDev } = await import('./ValleyLookDev.js');
  const times = $('times');
  for (const [key, t] of Object.entries(PALETTE.times)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.time = key;
    b.textContent = t.label;
    times.append(b);
  }
  const NAMES = { seller: 'Bu Sari', elder: 'Kakek Darma', child: 'Tia' };
  const seasons = $('seasons');
  for (const [key, t] of Object.entries(PALETTE.seasons)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.season = key;
    b.textContent = t.label;
    seasons.append(b);
  }
  const ui = {
    balloon(text, x, y, who) {
      const el = $('balloon');
      el.hidden = !text;
      if (!text) return;
      $('balloonWho').textContent = NAMES[who] || '';
      $('balloonText').textContent = text;
      // Keep it on screen: the balloon sits above (x, y), so it needs its own height of room
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = `${Math.min(innerWidth - w / 2 - 16, Math.max(w / 2 + 16, x))}px`;
      el.style.top = `${Math.max(h + 28, y)}px`;
    },
    onView(dev) {
      for (const b of times.children) b.classList.toggle('is-on', b.dataset.time === dev.sky.name);
      for (const b of seasons.children) b.classList.toggle('is-on', b.dataset.season === dev.season);
      const url = new URL(location.href);
      url.searchParams.set('time', dev.sky.name);
      if (dev.season) url.searchParams.set('season', dev.season);
      history.replaceState(null, '', url);
    }
  };
  const dev = new ValleyLookDev(engine, ui);
  await dev.enter({ time: PALETTE.times[params.get('time')] ? params.get('time') : 'pagi', crowd: Math.min(20, Number(params.get('crowd')) || 0), season: params.get('season') || 'semi' });
  engine.setMode(dev);
  ui.onView(dev);
  document.body.classList.add('ready');
  times.addEventListener('click', (e) => e.target.dataset.time && dev.setTime(e.target.dataset.time));
  seasons.addEventListener('click', (e) => e.target.dataset.season && dev.setSeason(e.target.dataset.season));
  $('rotL').addEventListener('click', () => dev.rotate(-1));
  $('rotR').addEventListener('click', () => dev.rotate(1));
  $('recenter').addEventListener('click', () => dev.cam.recenter());
  // Tool chips and the context line (what E would do)
  const { TOOLS } = await import('./play/farmActions.js');
  const tools = $('tools'), context = $('context');
  TOOLS.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<kbd>${i + 1}</kbd>${t.label}`;
    b.addEventListener('click', () => dev.actions.setTool(i));
    tools.append(b);
  });
  const hud = () => {
    [...tools.children].forEach((b, i) => b.classList.toggle('is-on', i === dev.actions.tool));
    const c = dev.actions.context();
    const cell = dev.actions.targetCell();
    context.textContent = c ? `E: ${c.label}` : cell && !dev.actions.carrying ? `Spasi: ${TOOLS[dev.actions.tool].label}` : '';
  };
  setInterval(hud, 120);
  const stats = $('stats');
  setInterval(() => {
    const info = engine.renderer.info.render;
    stats.textContent = `${info.calls} draw · ${Math.round(info.triangles / 1000)}k tris · ${dev.stats.tufts} rumput · ${dev.stats.flowers} bunga · ${dev.stats.actors} orang · ${dev.stats.animals} hewan · ${dev.pickups.shipped} dikirim · build ${dev.stats.build} ms`;
  }, 500);
  if (import.meta.env.DEV) window.__valley = { engine, dev, three: await import('three') }; // dev-only QA handle
});
