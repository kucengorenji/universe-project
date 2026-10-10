import test from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../src/core/director.js';
import { t } from '../src/i18n/index.js';

// A player must never be left on a dead screen because a mode failed to load or enter.

const KEYS = ['window', 'location', 'history', 'requestAnimationFrame'];

async function withBrowser(run) {
  const saved = KEYS.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const location = { hash: '' };
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define('window', { addEventListener() {} });
  define('location', location);
  define('history', { replaceState: (_s, _t, hash) => { location.hash = hash; } });
  define('requestAnimationFrame', fn => setTimeout(fn, 0));
  try { return await run(); } finally {
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}

function build() {
  const log = [], notes = [], overlayLog = [], tradeSetups = [];
  const behavior = { space: {}, planet: {}, town: {}, home: {}, trade: {} };
  const classFor = name => class FakeMode {
    static async prepare() { log.push(`prepare:${name}`); if (behavior[name].prepare) throw new Error(`${name} prepare failed`); }
    constructor(ctx, route) { this.name = name; this.route = route; log.push(`new:${name}`); }
    async enter() { log.push(`enter:${name}`); if (behavior[name].enter) throw new Error(`${name} enter failed`); }
    exit() { log.push(`exit:${name}`); if (behavior[name].exitThrows) throw new Error(`${name} exit failed`); }
    depart() { return Promise.resolve({ cover: 'fade' }); }
    arrived() {}
  };
  const modes = Object.fromEntries(Object.keys(behavior).map(name => [name, async () => {
    if (behavior[name].import) throw new Error(`${name} chunk missing`);
    return { default: classFor(name) };
  }]));
  const overlay = {
    cover: async () => overlayLog.push('cover'), reveal: async () => overlayLog.push('reveal'),
    showLoading: label => overlayLog.push(`loading:${label}`), hideLoading: () => overlayLog.push('hide'),
    setProgress: (_frac, label) => overlayLog.push(`progress:${label}`), capture() {}
  };
  const engine = { current: null, setMode(mode) { this.current = mode; }, afterFrame: async cb => cb?.(), post: { configure() {} }, renderer: { domElement: {} } };
  const world = {
    ready: Promise.resolve(), worldId: 'w', homeIndex: 0, state: { get: () => null },
    planet: i => (i === 0 || i === 1 ? { landable: true } : null), mapFor: () => ({ cities: [{}, {}] })
  };
  const trade = { items: [{ id: 'c1', planet: 1, worldId: 'w' }], loadError: null };
  const director = new Director({ engine, world, overlay, trade }, { modes, notify: message => notes.push(message), openTradeSetup: async (...args) => tradeSetups.push(args) });
  return { director, behavior, log, notes, overlayLog, tradeSetups, engine, trade };
}

const idle = async director => { for (let i = 0; i < 50 && (director.busy || director.pending); i++) await new Promise(r => setTimeout(r, 5)); };
const PLANET = { mode: 'planet', planet: 0, city: null }, TOWN = { mode: 'town', planet: 0, city: 1 };

test('a place whose preparation fails leaves the current place on screen, with a notice', () => withBrowser(async () => {
  const { director, behavior, log, notes, overlayLog } = build();
  await director.go(PLANET);
  assert.equal(director.mode.name, 'planet');
  behavior.town.prepare = true;
  log.length = 0; overlayLog.length = 0;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'planet', 'still on the planet');
  assert.ok(!log.includes('exit:planet'), 'the planet was never torn down');
  assert.deepEqual(director.route, PLANET);
  assert.equal(location.hash, '#/planet/0', 'the address bar matches what is on screen');
  assert.deepEqual(notes, [t('loading.recovered.stay')]);
  assert.equal(overlayLog.at(-1), 'reveal', 'the cover is lifted');
  assert.equal(director.busy, false);
  behavior.town.prepare = false;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'town', 'the next attempt works without a reload');
}));

test('a place that fails while being built is cleaned up and the previous place comes back', () => withBrowser(async () => {
  const { director, behavior, log, notes, overlayLog, engine } = build();
  await director.go(PLANET);
  behavior.town.enter = true;
  log.length = 0; overlayLog.length = 0;
  await director.go(TOWN);
  assert.deepEqual(log.filter(entry => /^(exit|new|enter):/.test(entry)), ['exit:planet', 'new:town', 'enter:town', 'exit:town', 'new:planet', 'enter:planet']);
  assert.equal(director.mode.name, 'planet');
  assert.equal(engine.current, director.mode);
  assert.deepEqual(director.route, PLANET);
  assert.equal(location.hash, '#/planet/0');
  assert.deepEqual(notes, [t('loading.recovered.fallback')]);
  assert.equal(overlayLog.at(-1), 'reveal');
  assert.ok(!overlayLog.some(entry => entry.startsWith('progress:')), 'no dead "failed" screen');
}));

test('when the previous place cannot be rebuilt either, the player ends up in space', () => withBrowser(async () => {
  const { director, behavior, notes } = build();
  await director.go(PLANET);
  behavior.planet.enter = true;
  behavior.town.enter = true;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'space');
  assert.equal(location.hash, '#/space/0');
  assert.equal(notes.length, 1);
}));

test('a failure at start-up (nothing was on screen) still reaches the planet', () => withBrowser(async () => {
  const { director, behavior } = build();
  behavior.town.enter = true;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'planet');
  assert.deepEqual(director.route, PLANET);
}));

test('a missing chunk, or a mode that throws on exit, does not strand the player', () => withBrowser(async () => {
  const { director, behavior } = build();
  await director.go(PLANET);
  behavior.town.import = true;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'planet', 'a chunk that cannot be fetched is a failed preparation');
  behavior.town.import = false;
  behavior.planet.exitThrows = true;
  await director.go(TOWN);
  assert.equal(director.mode.name, 'town', 'leaving a broken mode does not block the next one');
  behavior.town.exitThrows = true;
  behavior.planet.enter = true; // its half-built instance also throws on exit (set above)
  await director.go({ mode: 'planet', planet: 0, city: null });
  assert.equal(director.mode.name, 'town', 'cleanup that throws does not mask the recovery: the town the player left is rebuilt');
}));

test('when nothing can be built the reload message stays, and a later attempt can still recover', () => withBrowser(async () => {
  const { director, behavior, overlayLog } = build();
  for (const name of ['space', 'planet', 'town']) behavior[name].enter = true;
  await director.go(TOWN);
  assert.equal(director.mode, null);
  assert.equal(overlayLog.at(-1), `progress:${t('loading.failed')}`);
  assert.equal(director.busy, false);
  for (const name of ['space', 'planet', 'town']) behavior[name].enter = false;
  await director.go(PLANET);
  assert.equal(director.mode.name, 'planet');
}));

test('a request made during a failing switch is still handled afterwards', () => withBrowser(async () => {
  const { director, behavior } = build();
  await director.go(PLANET);
  behavior.town.enter = true;
  const failing = director.go(TOWN);
  await director.go({ mode: 'space', planet: 0 }); // queued while the town is failing
  await failing;
  await idle(director);
  assert.equal(director.mode.name, 'space');
  assert.deepEqual(director.route, { mode: 'space', planet: 0 });
}));

test('a Trade campaign that fails to open returns to its planet and shows the setup with the reason', () => withBrowser(async () => {
  const { director, behavior, tradeSetups, trade, notes } = build();
  await director.go({ mode: 'planet', planet: 1, city: null });
  behavior.trade.prepare = true;
  await director.go({ mode: 'trade', planet: 1, campaign: 'c1' });
  assert.equal(director.mode.name, 'planet');
  assert.equal(trade.loadError, 'trade prepare failed');
  assert.equal(tradeSetups.length, 1);
  assert.equal(tradeSetups[0][1], 1);
  assert.deepEqual(tradeSetups[0][3], { forceDialog: true });
  assert.equal(notes.length, 1);
  // and a broken build of the Trade mode itself
  behavior.trade.prepare = false;
  behavior.trade.enter = true;
  await director.go({ mode: 'trade', planet: 1, campaign: 'c1' });
  assert.equal(director.mode.name, 'planet');
  assert.equal(tradeSetups.length, 2);
}));
