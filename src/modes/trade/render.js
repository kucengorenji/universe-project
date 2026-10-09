import * as THREE from 'three';
import { FACILITIES } from '../../trade/catalog.js';
import { siteAccess } from '../../trade/resources.js';
import { nearby } from '../../trade/routing.js';

const COLORS = { farm: 0x95ac55, bakery: 0xdbad67, logging: 0x8d6a40, quarry: 0x979b9e, mine: 0x73665e, workshop: 0xb58561, warehouse: 0xb1a38c, depot: 0xaba093, port: 0x629baf };
export function renderMap(base, state) {
  const map = structuredClone(base);
  map.cities = state.cities.map((c, index) => ({ index, tileId: c.tileId, tiles: [c.tileId], size: c.tier,
    type: c.owner === 'player' ? 'capital' : 'town', owner: c.owner === 'player' ? 'player' : null,
    name: c.name, style: 'fantasy', isPort: false }));
  for (const city of map.cities) { const t = map.tilesData[city.tileId]; t.cityIndex = city.index; t.owner = city.owner; }
  return map;
}

export class TradeView {
  constructor(pr, session) {
    this.pr = pr; this.session = session;
    this.root = new THREE.Group(); pr.planetGroup.add(this.root);
    this.structures = new Map(); this.routes = new Map(); this.movers = new Map(); this.extraLabels = [];
    this.materials = new Set(); this.geometries = new Set(); this.masked = new Map();
    this.initialCities = new Set(session.state.cities.map(c => c.id));
    this.markers = new THREE.Group(); this.root.add(this.markers);
    this.ghost = null; this.following = null; this.overlay = 'resources';
  }
  material(color, opacity = 1) { const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity === 1 }); this.materials.add(m); return m; }
  releaseMesh(mesh) {
    if (!mesh) return;
    this.root.remove(mesh);
    if (this.geometries.delete(mesh.geometry)) mesh.geometry.dispose();
    if (this.materials.delete(mesh.material)) mesh.material.dispose();
  }
  plate(tileId, color, opacity = .65) {
    const geometry = this.pr.roundedBand([tileId], .15, .008); this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, this.material(color, opacity)); this.root.add(mesh); return mesh;
  }
  curve(path, sea = false) {
    const pts = [], tiles = this.pr.hexasphere.tileMap;
    for (let i = 0; i < path.length - 1; i++) {
      const a = tiles.get(path[i]).center, b = tiles.get(path[i + 1]).center;
      for (let j = 0; j < 5; j++) {
        const dir = a.clone().lerp(b, j / 5).normalize();
        const tile = tiles.get(path[i]);
        pts.push(dir.multiplyScalar((sea ? this.pr.waterR : this.pr.surfaceRadius(dir, tile)) + .014));
      }
    }
    pts.push(tiles.get(path.at(-1)).center.clone().multiplyScalar((sea ? this.pr.waterR : this.pr.landR) + .014));
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }
  line(path, color, sea = false, small = false) {
    if (path.length < 2) return null;
    const curve = this.curve(path, sea);
    const geo = new THREE.TubeGeometry(curve, Math.min(500, path.length * 6), this.pr.tileRadius * (small ? .025 : .065), 3, false);
    this.geometries.add(geo);
    const mesh = new THREE.Mesh(geo, this.material(color)); this.root.add(mesh); return { mesh, curve };
  }
  previewPath(path, sea = false) {
    const key = `${sea}:${path.join(',')}`;
    if (this.preview?.key === key) return;
    this.clearPreview(); this.preview = { ...this.line(path, 0x027b49, sea), key };
  }
  clearPreview() { this.releaseMesh(this.preview?.mesh); this.preview = null; }
  model(asset, tileId, scale = .85) {
    const pr = this.pr, geo = pr.assets?.[asset] || pr.assets?.barn;
    if (!geo) return new THREE.Group();
    const mesh = new THREE.Mesh(geo, pr.propMaterial);
    mesh.applyMatrix4(pr.onSphere(pr.hexasphere.tileMap.get(tileId).center, pr.landR + .01, pr.tileRadius * scale, 0));
    this.root.add(mesh); return mesh;
  }
  refresh() {
    const s = this.session.state;
    if (!this.pr.assets) return;
    for (const f of s.facilities) {
      if (!this.structures.has(f.id)) {
        const mesh = this.model(f.kind === 'farm' ? 'barn' : FACILITIES[f.kind].asset, f.tileId, .85);
        const plate = this.plate(f.tileId, COLORS[f.kind]);
        const connector = this.line(f.connector, 0xbdb089, false, true);
        this.structures.set(f.id, { mesh, plate, connector, level: f.level });
      }
      const item = this.structures.get(f.id);
      item.plate.material.opacity = f.construction ? .25 : f.active ? .7 : .25;
      item.mesh.visible = true;
      if (item.level !== f.level) { item.mesh.scale.multiplyScalar(1 + (f.level - item.level) * .12); item.level = f.level; }
    }
    for (const [id, item] of this.structures) if (!id.startsWith('city:') && !id.startsWith('port:') && !s.facilities.some(f => f.id === id)) {
      this.releaseMesh(item.mesh); this.releaseMesh(item.plate); this.releaseMesh(item.connector?.mesh); this.structures.delete(id);
    }
    for (const city of s.cities.filter(c => c.owner === 'npc' && c.port)) if (!this.structures.has(`port:${city.id}`)) {
      this.structures.set(`port:${city.id}`, { mesh: this.model('port', city.portTileId, .85), plate: this.plate(city.portTileId, COLORS.port) });
    }
    for (const city of s.cities) if (!this.initialCities.has(city.id) && !this.structures.has(city.id)) {
      const mesh = this.model('castle', city.tileId, 1.1), plate = this.plate(city.tileId, 0x027b49);
      const index = s.cities.indexOf(city), labelCity = { ...this.pr.mapData.cities[0], index, name: city.name, tileId: city.tileId, tiles: [city.tileId] };
      this.pr.mapData.cities.push(labelCity); this.pr.cityByIndex.set(index, labelCity);
      this.pr.hexasphere.tileMap.get(city.tileId).cityIndex = index;
      this.pr.mapData.tilesData[city.tileId].cityIndex = index;
      const sprite = this.pr.makeLabelSprite(labelCity), dir = this.pr.hexasphere.tileMap.get(city.tileId).center;
      sprite.position.copy(dir).multiplyScalar(this.pr.landR + this.pr.tileRadius * 1.7); this.root.add(sprite);
      this.pr.labels.push({ sprite, normal: dir.clone(), city: labelCity }); this.extraLabels.push(sprite);
      this.structures.set(city.id, { mesh, plate });
    }
    for (const r of s.routes) if (!this.routes.has(r.id)) {
      const item = this.line(r.path, r.mode === 'sea' ? 0x74b5ca : 0xcbb890, r.mode === 'sea');
      this.routes.set(r.id, item);
    }
    for (const [id, r] of this.routes) if (!s.routes.some(route => route.id === id)) { this.releaseMesh(r.mesh); this.routes.delete(id); }
    const sig = s.facilities.map(f => f.id).join(',') + s.cities.length + ':' + this.pr.lod0Ready + ':' + this.pr.chunks.length;
    if (sig !== this.maskSignature) { this.maskSignature = sig; this.maskNature(); this.showOverlay(this.overlay); }
  }
  maskNature() {
    for (const [inst, entries] of this.masked) { for (const [i, matrix] of entries) inst.setMatrixAt(i, matrix); inst.instanceMatrix.needsUpdate = true; }
    this.masked.clear();
    const s = this.session.state;
    const targets = [...s.facilities.map(f => f.tileId), ...s.cities.filter(c => !this.initialCities.has(c.id)).map(c => c.tileId), ...s.cities.filter(c => c.owner === 'npc' && c.port).map(c => c.portTileId)]
      .map(id => this.pr.hexasphere.tileMap.get(id).center);
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3();
    const distance = this.pr.tileRadius / this.pr.radius * .8;
    for (const chunk of this.pr.chunks) for (const level of chunk.levels) for (const group of [level.main, level.detail]) group.traverse(inst => {
      if (!inst.isInstancedMesh) return;
      const entries = [];
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, matrix); pos.setFromMatrixPosition(matrix).normalize();
        if (targets.some(t => t.distanceTo(pos) < distance)) { entries.push([i, matrix.clone()]); inst.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
      }
      if (entries.length) { this.masked.set(inst, entries); inst.instanceMatrix.needsUpdate = true; }
    });
  }
  showOverlay(kind) {
    this.overlay = kind;
    for (const child of [...this.markers.children]) { this.markers.remove(child); child.geometry.dispose(); this.geometries.delete(child.geometry); }
    if (kind !== 'resources') return;
    const s = this.session.state, area = new Set();
    for (const c of s.cities) for (const tile of nearby(this.session.graph, c.tileId, 4).keys()) area.add(tile);
    const occupied = new Set([...s.cities.map(c => c.tileId), ...s.facilities.map(f => f.tileId)]);
    const positions = [];
    for (const id of area) {
      if (occupied.has(id)) continue;
      const site = siteAccess(this.session.graph, this.session.base.resourcePlan, id);
      const color = site.ore ? 0x976b5a : site.wood ? 0x027b49 : site.fertility ? 0xc2a84e : site.stone ? 0x8a9094 : null;
      if (!color) continue;
      positions.push({ id, color });
    }
    const geo = new THREE.CircleGeometry(this.pr.tileRadius * .12, 6); this.geometries.add(geo);
    const mat = this.resourceMaterial || (this.resourceMaterial = this.material(0xffffff));
    const inst = new THREE.InstancedMesh(geo, mat, positions.length);
    positions.forEach(({ id, color }, i) => {
      const t = this.pr.hexasphere.tileMap.get(id), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.center);
      inst.setMatrixAt(i, new THREE.Matrix4().compose(t.center.clone().multiplyScalar(this.pr.landR + .025), q, new THREE.Vector3(1, 1, 1)));
      inst.setColorAt(i, new THREE.Color(color));
    });
    this.markers.add(inst);
  }
  highlight(ids) {
    this.clearHighlights();
    const geo = new THREE.RingGeometry(this.pr.tileRadius * .66, this.pr.tileRadius * .78, 6); this.geometries.add(geo);
    const mat = this.material(0x027b49, .95), mesh = new THREE.InstancedMesh(geo, mat, ids.length);
    ids.forEach((id, i) => { const t = this.pr.hexasphere.tileMap.get(id), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.center);
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(t.center.clone().multiplyScalar(this.pr.landR + .012), q, new THREE.Vector3(1, 1, 1))); });
    this.root.add(mesh); this.highlightMeshes = [mesh];
  }
  clearHighlights() { for (const mesh of this.highlightMeshes || []) { this.root.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); this.geometries.delete(mesh.geometry); this.materials.delete(mesh.material); } this.highlightMeshes = []; this.clearGhost(); this.clearPreview(); }
  ghostAt(kind, tileId, valid) {
    this.clearGhost(); if (tileId === undefined) return;
    const asset = kind === 'city' ? 'castle' : kind === 'farm' ? 'barn' : FACILITIES[kind]?.asset;
    const geo = this.pr.assets?.[asset] || this.pr.assets?.barn; if (!geo) return;
    const mat = this.material(valid ? 0x027b49 : 0xfa4d43, .55);
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.applyMatrix4(this.pr.onSphere(this.pr.hexasphere.tileMap.get(tileId).center, this.pr.landR + .025, this.pr.tileRadius * .9, 0)); this.root.add(this.ghost);
  }
  clearGhost() { if (this.ghost) { this.root.remove(this.ghost); this.ghost.material.dispose(); this.materials.delete(this.ghost.material); this.ghost = null; } }
  update(alpha) {
    const s = this.session.state, pr = this.pr;
    const journeys = [...s.shipments, ...s.cities.filter(c => c.founding > 0).map(c => ({ id: `founder:${c.id}`, founding: true, cityId: c.id, path: c.foundingPath, elapsed: c.foundingTotal - c.founding, seconds: c.foundingTotal }))];
    for (const sh of journeys) {
      let item = this.movers.get(sh.id);
      if (!item) {
        const route = sh.founding ? { mode: 'land', path: sh.path } : s.routes.find(r => r.id === sh.routeId), geo = pr.assets?.[route.mode === 'sea' ? 'ship' : 'caravan']; if (!geo) continue;
        const mesh = new THREE.Mesh(geo, pr.propMaterial); mesh.scale.setScalar(pr.tileRadius * (route.mode === 'sea' ? .55 : .65));
        mesh.userData.shipmentId = sh.id; this.root.add(mesh);
        item = { mesh, curve: this.routes.get(route.id)?.curve || this.curve(route.path, route.mode === 'sea') }; this.movers.set(sh.id, item);
      }
      let progress = Math.min(.999, (sh.elapsed + alpha) / sh.seconds); if (sh.reverse) progress = 1 - progress;
      item.mesh.position.copy(item.curve.getPointAt(progress));
      const up = item.mesh.position.clone().normalize(), tangent = item.curve.getTangentAt(progress).multiplyScalar(sh.reverse ? -1 : 1);
      tangent.addScaledVector(up, -tangent.dot(up)).normalize();
      item.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, up, new THREE.Vector3().crossVectors(tangent, up)));
    }
    for (const [id, item] of this.movers) if (!journeys.some(sh => sh.id === id)) { this.root.remove(item.mesh); this.movers.delete(id); if (this.following === id) this.following = null; }
    if (this.following && this.movers.has(this.following)) {
      const mesh = this.movers.get(this.following).mesh, up = mesh.position.clone().normalize();
      pr.camera.up.copy(up); pr.camera.position.copy(mesh.position).addScaledVector(up, pr.tileRadius * 12).add(new THREE.Vector3(pr.tileRadius * 5, 0, 0)); pr.camera.lookAt(mesh.position);
    }
  }
  pick(event) {
    const rect = this.pr.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.pr.camera);
    const hits = ray.intersectObjects([...this.movers.values()].map(m => m.mesh));
    if (!hits.length) return null;
    const hit = hits[0], local = hit.object.position.clone().normalize();
    if (local.dot(this.pr.camera.position.clone().normalize()) < this.pr.radius / this.pr.camera.position.length() - .1) return null;
    return hit.object.userData.shipmentId;
  }
  destroy() {
    this.pr.planetGroup.remove(this.root);
    for (const sprite of this.extraLabels) { sprite.material.map?.dispose(); sprite.material.dispose(); }
    for (const geo of this.geometries) geo.dispose(); for (const mat of this.materials) mat.dispose();
    this.structures.clear(); this.routes.clear(); this.movers.clear(); this.masked.clear();
  }
}
