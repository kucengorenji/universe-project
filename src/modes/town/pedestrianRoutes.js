import { mulberry32 } from '../../map/mapGenerator.js';
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
        lane: edge.lanes[from === edge.a ? 1 : 0], pause: 0, flee: 0, rng: random, transitions: 0 };
      this.walkers.push(walker);
      this.pose(walker, null);
    }
  }

  pose(w, near) {
    const p = this.crowd.people[w.i], edge = this.graph.edges[w.edge];
    Object.assign(p, edgePoint(this.graph, edge, w.from, w.s, w.lane));
    p.y = this.heightAt(p.x, p.z);
    p.speed = w.pause > 0 ? 0 : w.speed * (w.flee > 0 ? 2.8 : 1);
    p.visible = near ? near(p.x, p.z) : true;
  }

  /** A nearby walker runs away along safe paths, without being teleported. */
  flee(x, z, fromX, fromZ) {
    let best = null, distance = 12;
    for (const w of this.walkers) {
      const p = this.crowd.people[w.i], d = Math.hypot(p.x - x, p.z - z);
      if (d < distance) { best = w; distance = d; }
    }
    if (best) this.startle(best, fromX, fromZ, 5);
  }

  startle(w, x, z, seconds) {
    if (w.flee > 0) return;
    const e = this.graph.edges[w.edge], a = this.graph.nodes[w.from], b = this.graph.nodes[e.a === w.from ? e.b : e.a];
    if (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z)) {
      w.from = e.a === w.from ? e.b : e.a;
      w.s = e.length - w.s;
      w.lane *= -1; // preserve the physical lane when reversing direction
    }
    w.pause = 0;
    w.flee = seconds;
  }

  chooseNext(w) {
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
    if (w.flee <= 0 && (node.portals.length || (!forward.length && edge.kind === 'garden'))) w.pause = 3 + w.rng() * 6;
    else if (w.flee <= 0 && node.edges.length > 2 && w.rng() < .15) w.pause = .4 + w.rng();
  }

  update(dt, near, threat = null) {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const w of this.walkers) {
      const p = this.crowd.people[w.i];
      if (threat?.speed > 0) {
        const dx = p.x - threat.x, dz = p.z - threat.z;
        const ahead = (dx * threat.vx + dz * threat.vz) / threat.speed;
        const side = Math.abs(dx * threat.vz - dz * threat.vx) / threat.speed;
        if (ahead > 0 && ahead < 9 && side < 2.6) this.startle(w, threat.x, threat.z, 1.5);
      }
      // Consume pauses and edge ends exactly. Normal frame dt is small; this
      // also supports deterministic fast-forward in the navigation QA harness.
      let remaining = dt;
      while (remaining > 1e-8) {
        if (w.pause > 0) { const t = Math.min(remaining, w.pause); w.pause -= t; remaining -= t; continue; }
        const edge = this.graph.edges[w.edge], speed = w.speed * (w.flee > 0 ? 2.8 : 1);
        const t = Math.min(remaining, (edge.length - w.s) / speed, w.flee > 0 ? w.flee : Infinity);
        w.s = Math.min(edge.length, w.s + speed * t);
        p.phase += t * speed * 5.2;
        remaining -= t; w.flee = Math.max(0, w.flee - t);
        if (w.s >= edge.length - 1e-8) this.chooseNext(w);
      }
      this.pose(w, near);
    }
  }
}
