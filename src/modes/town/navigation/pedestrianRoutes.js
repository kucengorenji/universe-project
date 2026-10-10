import { mulberry32 } from '../../../math/random.js';
import { edgePoint } from './walkNetwork.js';

// Ambient walkers, not household simulation. Each walker owns its random
// stream: lowering the rendered population cannot change another one's route.
export class Pedestrians {
  constructor(crowd, first, graph, rng, heightAt) {
    this.crowd = crowd;
    this.graph = graph;
    this.heightAt = heightAt;
    this.walkers = [];
    const usable = graph.edges.filter(e => e.kind !== 'entrance' && graph.components[graph.nodes[e.a].component].length >= 12);
    const weights = usable.map(e => Math.min(80, e.length) * (e.kind === 'garden' ? 3 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = first; i < crowd.count; i++) {
      const random = mulberry32(Math.floor(rng() * 4294967296));
      const p = crowd.people[i];
      p.visible = false;
      if (!total) continue;
      let choice = random() * total, index = 0;
      while (index < usable.length - 1 && (choice -= weights[index]) > 0) index++;
      const edge = usable[index], from = random() < .5 ? edge.a : edge.b;
      const walker = { i, edge: edge.id, from, s: random() * edge.length, speed: 1 + random() * .6,
        lane: edge.lanes[from === edge.a ? 1 : 0], pause: 0, rng: random, transitions: 0 };
      this.walkers.push(walker);
      this.pose(walker, null);
    }
  }

  pose(w, near) {
    const p = this.crowd.people[w.i], edge = this.graph.edges[w.edge];
    Object.assign(p, edgePoint(this.graph, edge, w.from, w.s, w.lane));
    p.y = this.heightAt(p.x, p.z);
    if (w.faceYaw !== undefined && w.faceYaw !== null) p.yaw = w.faceYaw; // a greeting turns the body toward the player
    p.speed = w.pause > 0 || w.hold ? 0 : w.speed;
    p.visible = near ? near(p.x, p.z) : true;
  }

  /**
   * Keep one walker on a single street, pacing back and forth (a named townsperson's beat).
   * Returns the walker, or null when that index is not walking.
   */
  pin(index, edgeId, { tether = true } = {}) {
    const w = this.walkers.find(walker => walker.i === index), edge = this.graph.edges[edgeId];
    if (!w || !edge) return null;
    Object.assign(w, { edge: edge.id, from: edge.a, s: edge.length / 2, lane: edge.lanes[1], tether, pause: 0 });
    this.pose(w, null);
    return w;
  }

  chooseNext(w) {
    if (w.tether) {
      const edge = this.graph.edges[w.edge];
      w.from = edge.a === w.from ? edge.b : edge.a;
      w.s = 0;
      w.lane = edge.lanes[w.from === edge.a ? 1 : 0];
      w.transitions++;
      w.pause = 1 + w.rng() * 2;
      return;
    }
    const graph = this.graph, edge = graph.edges[w.edge], end = edge.a === w.from ? edge.b : edge.a;
    const node = graph.nodes[end];
    const forward = node.edges.filter(id => id !== edge.id);
    const choices = forward.length ? forward : [edge.id];
    // A little preference for public gardens makes them part of daily strolls.
    const weights = choices.map(id => graph.edges[id].kind === 'garden' ? 2 : 1);
    let pick = w.rng() * weights.reduce((a, b) => a + b, 0), index = 0;
    while (index < choices.length - 1 && (pick -= weights[index]) > 0) index++;
    w.edge = choices[index]; w.from = end; w.s = 0; w.transitions++;
    const next = graph.edges[w.edge];
    w.lane = next.lanes[w.from === next.a ? 1 : 0];
    if (node.portals.length || (!forward.length && edge.kind === 'garden')) w.pause = 3 + w.rng() * 6;
    else if (node.edges.length > 2 && w.rng() < .15) w.pause = .4 + w.rng();
  }

  update(dt, near) {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const w of this.walkers) {
      const p = this.crowd.people[w.i];
      // Consume pauses and edge ends exactly. Normal frame dt is small; this
      // also supports deterministic fast-forward in the navigation QA harness.
      let remaining = w.hold ? 0 : dt; // a greeting holds the walker where it stands
      while (remaining > 1e-8) {
        if (w.pause > 0) { const t = Math.min(remaining, w.pause); w.pause -= t; remaining -= t; continue; }
        const edge = this.graph.edges[w.edge], speed = w.speed;
        const t = Math.min(remaining, (edge.length - w.s) / speed);
        w.s = Math.min(edge.length, w.s + speed * t);
        p.phase += t * speed * 5.2;
        remaining -= t;
        if (w.s >= edge.length - 1e-8) this.chooseNext(w);
      }
      this.pose(w, near);
    }
  }
}
