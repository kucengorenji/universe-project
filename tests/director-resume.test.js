import test from 'node:test';
import assert from 'node:assert/strict';
import { Director } from '../src/core/director.js';

test('startup awaits the town before restoring its saved interior', async () => {
  const oldLocation = globalThis.location;
  globalThis.location = { hash: '#/town/1/0' };
  const saved = { planet: 1, city: 0, buildingId: 'building-a', floor: 2 };
  const calls = [];
  const ctx = {
    world: { homeIndex: 1, state: { get: key => key === 'playerLocation' ? saved : null } },
    sanitize: r => r,
    async go(route, options) {
      await Promise.resolve();
      calls.push({ route, options });
      this.mode = { async restoreInteriorLocation(value) { calls.push(value); } };
    }
  };
  try {
    await Director.prototype.start.call(ctx);
    assert.deepEqual(calls, [{ route: { mode: 'town', planet: 1, city: 0 }, options: { replace: true } }, saved]);
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
  }
});
