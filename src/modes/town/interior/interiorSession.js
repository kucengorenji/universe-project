import { loadInteriorRecord } from '../../../world/savedRecords.js';

// The part of going into a building that does not need three.js: the one-at-a-time
// transition guard, and opening and storing the room record. TownMode drives the
// camera, the fade and the Interior object; this module decides what is saved where.

/**
 * Doors, stairs and sleeping all fade the screen, wait, then change the scene. A
 * transition is one ticket: only one runs at a time, and leaving the town (cancel)
 * kills the ticket, so a fade that finishes late does not touch a mode that is gone
 * or lift the cover the director put up.
 */
export class TransitionGuard {
  constructor() {
    this.generation = 0;
    this.active = null;
  }

  get busy() { return this.active !== null; }

  /** A ticket, or null while another transition is running. */
  begin() {
    if (this.active) return null;
    const guard = this, generation = this.generation;
    const ticket = {
      get alive() { return guard.generation === generation; },
      end() { if (guard.active === ticket) guard.active = null; }
    };
    this.active = ticket;
    return ticket;
  }

  /** Run `task(ticket)`; the ticket always ends, even when the task throws. Resolves undefined when busy. */
  async run(task) {
    const ticket = this.begin();
    if (!ticket) return undefined;
    try { return await task(ticket); } finally { ticket.end(); }
  }

  /** The mode is going away: every ticket handed out so far is dead. */
  cancel() {
    this.generation++;
    this.active = null;
  }
}

export const interiorStateKey = (planet, buildingId) => `interior:${planet}:${buildingId}`;

/**
 * Open the saved room behind `door`: the record to play on, the legacy snapshot for rooms
 * saved before floors, and the floor to start on (a request outside the building falls back
 * to the ground floor, and legacy rooms only have one).
 */
export function openInteriorSession(state, planet, door, requestedFloor = 0) {
  const key = interiorStateKey(planet, door.b.id);
  const { record, legacy, quarantined } = loadInteriorRecord(state, key);
  const floors = door.b.blueprint.floors;
  const floor = legacy || !Number.isInteger(requestedFloor) || requestedFloor < 0 || requestedFloor >= floors ? 0 : requestedFloor;
  return { key, record, legacy, quarantined, floor, snapshot: legacy || record.floors[floor] };
}

/** Write the room's current state back where it was read from. */
export function storeInterior(state, { key, record }, interior) {
  if (interior.layoutVersion === 1) state.set(key, interior.snapshot());
  else {
    record.floors[interior.floor] = interior.snapshot();
    state.set(key, record);
  }
}
