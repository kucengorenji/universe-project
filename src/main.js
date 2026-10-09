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
import { TradeSession } from './trade/session.js';
import './modes/trade/ui/trade.css';

// App shell: one canvas, one world, one mode on screen at a time.
//   #/space          star system (ship, orbits, landing)
//   #/planet/<i>     the hex globe of a planet
//   #/town/<i>/<c>   inside a city
window.addEventListener('DOMContentLoaded', async () => {
  applyDom(); // static markup is English; this swaps in the saved language before any module reads the DOM
  const engine = new Engine(document.getElementById('canvas-container'));
  const audio = (engine.audio = new Audio());
  const world = new World();
  const trade = (engine.trade = new TradeSession(world));
  const overlay = new Overlay(document.getElementById('cover'));
  const missions = new Missions(document.getElementById('missionUi'), audio);
  const tips = new Tips(document.getElementById('tipUi'));
  engine.pauseMenu = new PauseMenu(document.getElementById('pauseUi'), { engine, audio, missions, tips, world });
  const director = new Director({ engine, world, overlay, missions, audio, tips, trade });
  await world.ready;
  director.start();
  if (import.meta.env.DEV) window.__globe = { engine, world, director, missions, audio, trade, three: await import('three') }; // dev-only debug/visual QA handle
});
