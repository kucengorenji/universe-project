import { quarantineCount } from './savedRecords.js';

// What the player is told about saving, worst news first. The pause menu shows the
// text and flags its button on 'error'.
//   mapError  the home map did not reach browser storage: a reload gives a different world
//   error     a write to browser storage failed (rooms, homes, missions, tips)
//   notice    saved data from another build was set aside, nothing is lost
export function saveStatus({ world = null, missions = null, tips = null } = {}) {
  if (world?.mapSaveError) return { level: 'error', key: 'pause.save.mapError' };
  if (world?.state?.error || missions?.saveError || tips?.saveError) return { level: 'error', key: 'pause.save.error' };
  const held = world?.state ? quarantineCount(world.state) : 0;
  if (held) return { level: 'notice', key: 'pause.save.quarantine', params: { n: held } };
  return { level: 'ok', key: 'pause.save.ok' };
}
