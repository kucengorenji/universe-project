// Original interaction anchors are stable even when loose items are moved.
export function assignInteractionIds(interactables) {
  const counts = new Map();
  for (const it of interactables) {
    const base = `${it.kind}:${it.asset || (it.radio ? 'radio' : '')}:${it.x.toFixed(3)}:${it.z.toFixed(3)}`;
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    it.id = `${base}:${n}`;
  }
}

export function captureInterior(interior) {
  return {
    schemaVersion: 1,
    holdingId: interior.holding?.id || null,
    objects: Object.fromEntries(interior.interactables.map(it => [it.id, {
      on: !!it.on, target: it.target || 0,
      ...(it.kind === 'item' ? { position: it.mesh.position.toArray(), x: it.x, z: it.z } : {})
    }]))
  };
}

export function restoreInterior(interior, state) {
  if (state?.schemaVersion !== 1 || !state.objects) return;
  for (const it of interior.interactables) {
    const s = state.objects[it.id];
    if (!s) continue;
    if (it.kind === 'light') interior.setLamp(it, !!s.on, false);
    if (it.kind === 'door') it.open = it.target = s.target === 1 ? 1 : 0;
    if (it.kind === 'media' || it.kind === 'fire') {
      it.on = !!s.on;
      if (it.mat) it.mat.color.set(it.on ? 0x6fb7ff : 0x0c1016);
      if (it.fire) it.fire.visible = it.on;
      if (it.light) it.light.intensity = it.on ? 8 : 0;
    }
    if (it.kind === 'item' && Array.isArray(s.position) && s.position.length === 3 && s.position.every(Number.isFinite)) {
      it.mesh.position.fromArray(s.position);
      it.x = Number.isFinite(s.x) ? s.x : s.position[0];
      it.z = Number.isFinite(s.z) ? s.z : s.position[2];
      it.taken = it.id === state.holdingId;
      if (it.taken) interior.holding = it;
    }
  }
}
