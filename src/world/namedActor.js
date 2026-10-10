import { seedFor } from './identity.js';
import { edgePoint } from '../modes/town/navigation/walkNetwork.js';

// The first named townsperson ("Damar", LIVING_WORLD_BOOK Proof 2). Identity is a pure
// function of the town, so the same person stands in the same place with the same look
// after a reload, after the pool hands the body to another slot, and on every visit.
// Nothing here is saved: no household, job or relationship exists behind the name.

export const DAMAR_NAME_KEY = 'actor.damar.name';
export const DAMAR_GREET_KEY = 'actor.damar.greet';

/** Same inputs, same person. `layoutSeed` is the town layout's seed (stable per world and city). */
export function damarIdentity({ planet, city, layoutSeed }) {
  const seed = seedFor(layoutSeed, 'named-actor', 'damar');
  return { actorId: `damar:${planet}:${city}:${seed.toString(36)}`, seed, nameKey: DAMAR_NAME_KEY, greetKey: DAMAR_GREET_KEY };
}

const MIN_FROM_DOOR = 6; // metres: outside the entrance clearance and the vehicle exits
const PREFERRED_FROM_DOOR = 18; // close enough to meet on the way to the house, far enough not to crowd the door
const MIN_EDGE = 6;

/**
 * The street segment Damar paces. A usable street (not an entrance, in a network of at least 12
 * nodes, at least 6 m long) whose middle is at least 6 m from the starter door, nearest to
 * 18 m from it; ties go to the lower edge id. With no door the spawn stands in for it.
 */
export function chooseDamarAnchor(graph, { door = null, spawn = { x: 0, z: 0 } } = {}) {
  const from = door ?? spawn;
  let best = null;
  for (const edge of graph?.edges || []) {
    if (edge.kind === 'entrance' || edge.length < MIN_EDGE) continue;
    if ((graph.components[graph.nodes[edge.a].component]?.length ?? 0) < 12) continue;
    const mid = edgePoint(graph, edge, edge.a, edge.length / 2, edge.lanes[1]);
    const distance = Math.hypot(mid.x - from.x, mid.z - from.z);
    if (distance < MIN_FROM_DOOR) continue;
    const score = Math.abs(distance - PREFERRED_FROM_DOOR);
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && edge.id < best.edge)) best = { edge: edge.id, score, x: mid.x, z: mid.z };
  }
  return best;
}
