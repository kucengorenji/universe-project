import './skirmish.css';
import { Engine } from '../core/engine.js';

// Skirmish page (skirmish.html): a Valkyria Chronicles-style squad battle on a generated
// battlefield, separate from the universe game. skirmish.html?lookdev opens the art
// look-development scene instead of the game.

const params = new URLSearchParams(location.search);
const randomSeed = () => Math.floor(Math.random() * 1e6);

window.addEventListener('DOMContentLoaded', async () => {
  const engine = new Engine(document.getElementById('stage'));
  const $ = (id) => document.getElementById(id);
  if (params.has('lookdev')) return lookdev(engine, $);
  const { SkirmishGame } = await import('./play/SkirmishGame.js');
  const game = new SkirmishGame(engine, { mapEl: $('map'), prepEl: $('prep'), hudEl: $('hud') });
  engine.setMode(game);
  document.body.classList.add('ready');
  if (import.meta.env.DEV) window.__skirmish = { engine, game, three: await import('three') }; // dev-only QA handle
});

async function lookdev(engine, $) {
  const { LookDev } = await import('./lookdev.js');
  document.body.dataset.phase = 'lookdev';
  document.querySelector('.panel').hidden = false;
  const seedInput = $('seed');
  const stats = $('stats');
  const ui = {
    onBuilt(dev) {
      const s = dev.stats;
      stats.textContent = `seed ${dev.data.seed} · generate ${s.generate} ms · build ${s.build} ms · ${s.houses} houses · ${s.grass} grass tufts`;
      seedInput.value = dev.data.seed;
      const url = new URL(location.href);
      url.searchParams.set('seed', dev.data.seed);
      history.replaceState(null, '', url);
    }
  };
  const dev = new LookDev(engine, ui);
  const seed = Number(params.get('seed')) || randomSeed();
  await dev.enter({ seed, time: params.get('time') || 'day' });
  engine.setMode(dev);
  document.body.classList.add('ready');
  $('reroll').addEventListener('click', () => dev.build(randomSeed()));
  seedInput.addEventListener('change', () => dev.build(Number(seedInput.value) || 1));
  $('time').addEventListener('change', (e) => dev.setTime(e.target.value));
  $('pose').addEventListener('change', (e) => dev.setPose(e.target.value));
  $('canvasOn').addEventListener('change', (e) => (dev.post.enabled = e.target.checked));
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => dev.view(b.dataset.view));
  if (import.meta.env.DEV) window.__skirmish = { engine, dev, three: await import('three') }; // dev-only QA handle
}
