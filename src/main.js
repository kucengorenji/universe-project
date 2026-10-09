import './style.css';
import './modes/town/ui/pixel.css';
import { Engine } from './core/engine.js';
import { Overlay } from './core/overlay.js';
import { Director } from './core/director.js';
import { World } from './world/world.js';
import { Missions } from './core/missions.js';
import { Audio } from './core/audio.js';
import { Tips } from './core/tips.js';
import { PauseMenu } from './core/pauseMenu.js';
import './core/firebase.js';
import { applyDom } from './i18n/index.js';
import { prepareInspect } from './net/inspect.js';

// App shell: one canvas, one world, one mode on screen at a time.
//   #/space          star system (ship, orbits, landing)
//   #/planet/<i>     the hex globe of a planet
//   #/town/<i>/<c>   inside a city
window.addEventListener('DOMContentLoaded', async () => {
  applyDom(); // static markup is English; this swaps in the saved language before any module reads the DOM
  // ?inspect=<token>: an admin views a player's cloud save; storage is swapped for memory before anything reads it
  const inspect = await prepareInspect();
  const engine = new Engine(document.getElementById('canvas-container'));
  const audio = (engine.audio = new Audio());
  const world = new World();
  const overlay = new Overlay(document.getElementById('cover'));
  const missions = new Missions(document.getElementById('missionUi'), audio);
  const tips = new Tips(document.getElementById('tipUi'));
  const pause = new PauseMenu(document.getElementById('pauseUi'), { engine, audio, missions, tips, world });
  const director = new Director({ engine, world, overlay, missions, audio, tips });
  await world.ready;
  const started = director.start();
  // Backend (telemetry, sign-in, cloud sync, announcements) loads after the first scene, in its own chunk
  started
    .then(() => import('./net/index.js'))
    .then(({ setupNet }) => setupNet({ engine, world, director, missions, pause, inspect }))
    .catch((error) => console.warn('Backend features unavailable:', error));
  if (import.meta.env.DEV) window.__globe = { engine, world, director, missions, audio, three: await import('three') }; // dev-only debug/visual QA handle
});
