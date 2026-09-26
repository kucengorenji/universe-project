import './style.css';
import { Engine } from './core/engine.js';
import { Overlay } from './core/overlay.js';
import { Director } from './core/director.js';
import { World } from './world/world.js';
import { Missions } from './core/missions.js';

// App shell: one canvas, one world, one mode on screen at a time.
//   #/space          star system (ship, orbits, landing)
//   #/planet/<i>     the hex globe of a planet
//   #/town/<i>/<c>   inside a city
window.addEventListener('DOMContentLoaded', () => {
  const engine = new Engine(document.getElementById('canvas-container'));
  const world = new World();
  const overlay = new Overlay(document.getElementById('cover'));
  const missions = new Missions(document.getElementById('missionUi'));
  const director = new Director({ engine, world, overlay, missions });
  director.start();
  if (import.meta.env.DEV) window.__globe = { engine, world, director, missions }; // dev-only handle for debugging in the console
});
