/**
 * In a Vite browser tab already showing HomeMode:
 *   const qa = await import('/tools/qa/home_editor_browser.js');
 *   await qa.runHomeEditorChecks(window.__globe.director.mode);
 *
 * This uses live DOM buttons/change events and the real controller, raycaster,
 * model and geometry. Pointer handlers are invoked programmatically: native
 * pointer capture is stubbed because there is no browser-active pointer. This
 * does not verify physical input delivery, overlays, or performance.
 * The original editor state and durable home record are restored, even on failure.
 */
import * as THREE from 'three';
import * as Model from '../../src/modes/home/homeBlueprint.js';
import { homeKey } from '../../src/world/homeState.js';

const copy = value => structuredClone(value);
const json = value => JSON.stringify(value);
const items = bp => [...bp.items, ...bp.yard.items];
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, message) => ensure(json(actual) === json(expected), message);
const close = (actual, expected, message) => ensure(Number.isFinite(actual) && Math.abs(actual - expected) < .0001, message);

export async function runHomeEditorChecks(mode) {
  ensure(mode?.ui?.isConnected && mode.home && mode.ctx.director.mode === mode, 'Run checks in the active HomeMode browser tab.');
  ensure(!mode.planDrag && !mode.sceneDrag && !mode.lookDrag && !mode.applying, 'Finish the active editor transaction before running checks.');
  const state = mode.ctx.world.state, engine = mode.ctx.engine;
  await state.serial;
  ensure(!state.error, 'Browser storage must be working before running editor checks.');
  const key = homeKey(mode.route.planet, mode.route.city, mode.route.home), record = state.get(key);
  ensure(record, 'The active home record is missing.');
  const snapshot = {
    bp: copy(mode.bp), record: copy(mode.record), history: copy(mode.history), historyIndex: mode.historyIndex,
    floorId: mode.floorId, view: mode.view, tool: mode.tool, selected: mode.selected, roomId: mode.roomId,
    roofSection: mode.roofSection, cutaway: mode.cutaway, pendingPoints: copy(mode.pendingPoints), keys: new Set(mode.keys),
    walkPosition: mode.walkPosition?.clone(), walkYaw: mode.walkYaw, walkPitch: mode.walkPitch,
    savedCamera: mode.savedCamera && { position: mode.savedCamera.position.clone(), target: mode.savedCamera.target.clone() },
    camera: { position: mode.camera.position.clone(), quaternion: mode.camera.quaternion.clone(), up: mode.camera.up.clone() },
    orbitTarget: mode.orbit.target.clone(), orbitEnabled: mode.orbit.enabled, damping: mode.orbit.enableDamping,
    paused: engine.paused, invalid: mode.ui.getAttribute('data-invalid'),
    saveText: mode.ui.querySelector('[data-save]').textContent, saveClass: mode.ui.querySelector('[data-save]').className,
    controls: [...mode.ui.querySelectorAll('[data-field]')].map(el => ({ field: el.dataset.field, value: el.value, checked: el.checked, checkbox: el.type === 'checkbox' })),
  };
  const captures = [];

  const report = { status: 'NOT_RUN', checks: [], boundary: 'Real DOM/controller/raycast; synthetic pointer handlers with capture stubbed.' };
  const query = selector => { const element = mode.ui.querySelector(selector); ensure(element, `Missing control ${selector}`); return element; };
  const click = selector => { const element = query(selector); ensure(!element.disabled, `Control is disabled: ${selector}`); element.click(); };
  const change = (field, value) => {
    const element = query(`[data-field=${field}]`);
    if (element.type === 'checkbox') element.checked = value; else element.value = String(value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pointer = (x, y) => ({ button: 0, pointerId: 9107, clientX: x, clientY: y, stopImmediatePropagation() {} });
  const scenePoint = point => {
    mode.camera.updateMatrixWorld(true); mode.home.updateMatrixWorld(true);
    const p = new THREE.Vector3(point.x, point.y || 0, point.z).project(mode.camera), r = engine.renderer.domElement.getBoundingClientRect();
    return pointer(r.left + (p.x + 1) * r.width / 2, r.top + (1 - p.y) * r.height / 2);
  };
  const visibleItem = event => {
    mode.cast(event);
    for (const hit of mode.raycaster.intersectObject(mode.home, true)) {
      let object = hit.object, visible = true;
      for (let p = object; p; p = p.parent) if (!p.visible) visible = false;
      if (!visible) continue;
      while (object && !object.userData.itemId) object = object.parent;
      return object?.userData.itemId || null;
    }
    return null;
  };
  const itemPointer = id => {
    const object = mode.home.userData.items.get(id);
    ensure(object, `Missing rendered item ${id}`);
    mode.home.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object), center = box.getCenter(new THREE.Vector3());
    // Hollow GLBs may have no surface at their centre. Find an actual visible
    // mesh hit instead of replacing the production raycast or selecting by ID.
    const fractions = [.5, .1, .9, .25, .75];
    for (const fx of fractions) for (const fz of fractions) {
      const event = scenePoint({ x: THREE.MathUtils.lerp(box.min.x, box.max.x, fx), y: center.y, z: THREE.MathUtils.lerp(box.min.z, box.max.z, fz) });
      if (visibleItem(event) === id) return event;
    }
    throw new Error(`No unobstructed real geometry hit for ${id}`);
  };
  const startDrag = id => {
    mode.sceneDown(itemPointer(id));
    ensure(mode.sceneDrag?.kind === 'item' && mode.selected === id, `3D raycast did not select ${id}`);
  };
  const dragTo = position => {
    const drag = mode.sceneDrag;
    ensure(drag?.kind === 'item', 'An item drag must be active.');
    mode.sceneMove(scenePoint({ x: position.x - drag.offset.x, y: drag.planeY, z: position.z - drag.offset.z }));
  };
  const planPoint = point => {
    const { r, scale, cx, cz } = mode.planTransform();
    return pointer(r.left + r.width / 2 + (point.x - cx) * scale, r.top + r.height / 2 + (point.z - cz) * scale);
  };
  const fixture = (furnished = false) => {
    mode.cancelDrag();
    let bp = Model.createHomeBlueprint({ id: snapshot.bp.id, seed: 'editor-browser-fixture', floors: 2, attic: false, shape: 'rectangle', plot: [{ x: -18, z: -18 }, { x: 18, z: -18 }, { x: 18, z: 18 }, { x: -18, z: 18 }] });
    if (!furnished) {
      bp.items = []; bp.yard.items = [];
      for (const floor of bp.floors) for (const room of floor.rooms) room.points = room.points.map(p => ({ x: Math.round(p.x * 4) / 4, z: Math.round(p.z * 4) / 4 }));
    }
    bp = Model.reconcileHomeBlueprint(bp);
    ensure(Model.validateHomeBlueprint(bp).ok, 'The empty editor fixture must be valid.');
    Object.assign(mode, { bp, history: [copy(bp)], historyIndex: 0, floorId: bp.floors[0].id, view: 'orbit', tool: 'select', selected: null, roomId: null, roofSection: null, cutaway: true, pendingPoints: [] });
    mode.keys.clear(); mode.record.obstacles = []; mode.ui.dataset.view = 'orbit'; mode.ui.dataset.invalid = 'false';
    mode.placementPreview = null; mode.invalidPreview.visible = false;
    mode.rebuild(); mode.updateUI();
    mode.camera.up.set(0, 0, -1); mode.camera.position.set(0, 32, 0); mode.camera.lookAt(0, 0, 0);
    mode.orbit.target.set(0, 0, 0); mode.orbit.update(); mode.camera.updateMatrixWorld(true);
    change('placeTarget', 'floor');
    return bp;
  };

  let failure;
  const restoreErrors = [];
  try {
    engine.paused = true; mode.orbit.enableDamping = false;
    for (const canvas of [engine.renderer.domElement, mode.planCanvas]) for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture']) {
      captures.push({ canvas, name, descriptor: Object.getOwnPropertyDescriptor(canvas, name) });
      Object.defineProperty(canvas, name, { configurable: true, value: name === 'hasPointerCapture' ? () => false : () => {} });
    }
    fixture(); click('[data-add=chair]');
    const chairId = mode.selected, before = copy(mode.selectedItem.position), historyLength = mode.history.length;
    startDrag(chairId); mode.sceneUp();
    ensure(mode.history.length === historyLength, 'Clicking an unchanged item must not add Undo history.');
    report.checks.push('unchanged item click does not add Undo');

    const chair = mode.selectedItem;
    let destination;
    for (const [dx, dz] of [[.5, .5], [-.5, -.5], [.5, 0], [0, .5]]) {
      const p = { ...before, x: before.x + dx, z: before.z + dz };
      if (Model.placeHomeItem(mode.bp, chair.id, p).ok) { destination = p; break; }
    }
    ensure(destination, 'The empty room must offer a valid chair move.');
    startDrag(chairId); dragTo(destination); mode.sceneUp();
    const after = copy(mode.bp.items.find(i => i.id === chairId).position);
    ensure(json(after) !== json(before), 'A 3D chair drag must change its position.');
    close(after.x * 4, Math.round(after.x * 4), 'The chair must snap to the 0.25m x grid.');
    close(after.z * 4, Math.round(after.z * 4), 'The chair must snap to the 0.25m z grid.');
    report.checks.push('real 3D raycast drag and 0.25m snap');
    click('[data-act=undo]'); equal(mode.bp.items.find(i => i.id === chairId).position, before, 'Undo must restore the original chair.');
    click('[data-act=redo]'); equal(mode.bp.items.find(i => i.id === chairId).position, after, 'Redo must restore the moved chair.');
    report.checks.push('DOM Undo and Redo restore item transforms');

    startDrag(chairId); const valid = copy(mode.bp), validHistory = mode.history.length;
    dragTo({ x: 100, z: 100 });
    equal(mode.bp, valid, 'An invalid drag must retain the last valid blueprint.');
    ensure(mode.invalidPreview.visible && mode.ui.dataset.invalid === 'true', 'An invalid move must show the ghost and invalid state.');
    mode.sceneUp();
    ensure(!mode.invalidPreview.visible && mode.history.length === validHistory, 'Rejecting an invalid drag must hide its ghost and leave Undo unchanged.');
    report.checks.push('invalid drag ghost preserves the last valid item');

    fixture(true);
    const automaticId = mode.bp.items.find(i => i.floorId === mode.floorId && i.type === 'bed' && !i.authored)?.id;
    ensure(automaticId, 'The furnished fixture must contain an automatic bed.');
    startDrag(automaticId); mode.sceneUp(); click('[data-act=delete]'); click('[data-act=variation]');
    ensure(mode.bp.deletedItemIds.includes(automaticId) && !items(mode.bp).some(i => i.id === automaticId), 'Variation must not restore a deleted automatic item.');
    report.checks.push('DOM Delete survives Variation');

    fixture(); click('[data-add=table]'); const tableId = mode.selected; click('[data-add=vase]');
    const vaseId = mode.selected, vaseBefore = copy(mode.selectedItem.position), table = mode.bp.items.find(i => i.id === tableId);
    startDrag(vaseId); dragTo({ x: table.position.x + .25, z: table.position.z });
    ensure(!mode.invalidPreview.visible, 'The tabletop move must be accepted.'); mode.sceneUp();
    const vase = mode.bp.items.find(i => i.id === vaseId);
    ensure(json(vase.position) !== json(vaseBefore), 'The vase drag must actually move the item.');
    ensure(vase.anchor.kind === 'surface' && vase.anchor.targetId === tableId, 'The vase must snap to the real table support.');
    close(vase.position.y, table.position.y + Model.HOME_CATALOG.table.size[1], 'The vase must sit on the table.');
    report.checks.push('DOM table/vase addition and tabletop snap');

    change('floor', mode.bp.floors[1].id); click('[data-add=picture]');
    const pictureId = mode.selected, pictureBefore = copy(mode.selectedItem.position);
    startDrag(pictureId); dragTo({ x: pictureBefore.x + .25, z: pictureBefore.z });
    ensure(!mode.invalidPreview.visible, 'The wall snap move must be accepted.'); mode.sceneUp();
    const picture = mode.bp.items.find(i => i.id === pictureId);
    ensure(json(picture.position) !== json(pictureBefore), 'The picture drag must actually move the item.');
    ensure(picture.anchor.kind === 'wall', 'The picture must remain snapped to a wall.');
    close(picture.position.y, pictureBefore.y, 'A horizontal upper-floor picture drag must preserve hanging height.');
    report.checks.push('upper-floor wall snap preserves hanging height');

    const seed = 'repeatable-editor-browser-seed';
    change('seed', seed); click('[data-act=seed]'); const reproducible = copy(mode.bp);
    equal(reproducible, Model.createHomeBlueprint({ id: snapshot.bp.id, seed, style: reproducible.style, floors: 2, attic: false, plot: reproducible.plot }), 'Entered seed must generate the matching deterministic blueprint.');
    click('[data-act=seed]'); ensure(mode.bp.seed !== seed, 'Seed baru with unchanged input must choose a new seed.');
    change('seed', seed); click('[data-act=seed]'); equal(mode.bp, reproducible, 'Re-entering the seed must reproduce the whole house.');
    report.checks.push('New Seed is new and entered seeds reproduce the blueprint');

    fixture(); click('[data-view=plan]'); change('roomType', 'study'); click('[data-tool=rect]');
    const neighbor = mode.floor.rooms.find(r => r.id.endsWith('front-right')), x = Math.max(...neighbor.points.map(p => p.x)), z = Math.min(...neighbor.points.map(p => p.z));
    const roomIds = new Set(mode.floor.rooms.map(r => r.id));
    mode.planDown(planPoint({ x, z })); mode.planMove(planPoint({ x: x + 4, z: z + 4 })); mode.planUp();
    const drawn = mode.floor.rooms.find(r => !roomIds.has(r.id));
    ensure(drawn?.needsFurnishing, 'A newly drawn room must await furnishing.');
    click('[data-act=generate]');
    ensure(mode.bp.floors[0].rooms.find(r => r.id === drawn.id).needsFurnishing === false, 'Generate must finish the drawn room.');
    ensure(mode.bp.items.some(i => i.id.startsWith(`${drawn.id}:generated:`)), 'Generate must furnish the drawn room.');
    const furnished = copy(mode.bp); click('[data-act=generate]'); equal(mode.bp, furnished, 'Repeated Generate must not duplicate furniture.');
    report.checks.push('drawn room Generate furnishes once');

    fixture(); click('[data-view=plan]'); click('[data-tool=plot]');
    const plotBefore = copy(mode.bp), vertex = mode.bp.plot[1], down = planPoint(vertex), move = pointer(down.clientX + 20, down.clientY);
    mode.planDown(down); const scale = mode.planTransform().scale;
    mode.planMove(move); const first = copy(mode.bp.plot[1]); mode.planMove(move);
    equal(mode.bp.plot[1], first, 'A stationary plot pointer must not drift.');
    close(mode.planTransform().scale, scale, 'Plot scale must remain stable throughout the drag.');
    mode.planCanvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9107, bubbles: true }));
    equal(mode.bp, plotBefore, 'Pointer cancel must restore the plot transaction.');
    report.checks.push('plot drag has stable scale and cancellation restores it');
    report.status = 'PASS';
  } catch (error) { failure = error; }
  finally {
    try {
      mode.cancelDrag();
      Object.assign(mode, { bp: snapshot.bp, record: snapshot.record, history: snapshot.history, historyIndex: snapshot.historyIndex, floorId: snapshot.floorId, view: snapshot.view, tool: snapshot.tool, selected: snapshot.selected, roomId: snapshot.roomId, roofSection: snapshot.roofSection, cutaway: snapshot.cutaway, pendingPoints: snapshot.pendingPoints, keys: snapshot.keys, walkPosition: snapshot.walkPosition, walkYaw: snapshot.walkYaw, walkPitch: snapshot.walkPitch, savedCamera: snapshot.savedCamera });
      mode.ui.dataset.view = snapshot.view;
      mode.camera.position.copy(snapshot.camera.position); mode.camera.quaternion.copy(snapshot.camera.quaternion); mode.camera.up.copy(snapshot.camera.up); mode.camera.updateMatrixWorld(true);
      mode.orbit.target.copy(snapshot.orbitTarget); mode.orbit.enabled = snapshot.orbitEnabled; mode.orbit.enableDamping = snapshot.damping;
      mode.rebuild(); mode.updateUI(); mode.drawPlan();
      for (const control of snapshot.controls) {
        const element = query(`[data-field=${control.field}]`);
        if (control.checkbox) element.checked = control.checked; else element.value = control.value;
      }
      if (snapshot.invalid === null) mode.ui.removeAttribute('data-invalid'); else mode.ui.setAttribute('data-invalid', snapshot.invalid);
    } catch (error) { restoreErrors.push(error); }
    finally {
      for (const { canvas, name, descriptor } of captures) {
        try { if (descriptor) Object.defineProperty(canvas, name, descriptor); else delete canvas[name]; }
        catch (error) { restoreErrors.push(error); }
      }
      engine.paused = snapshot.paused;
      try {
        // Normal editor commits above really autosave. Restore the exact record,
        // including a null/older original draft, rather than saving the fixture.
        await state.set(key, record); await state.serial;
        ensure(!state.error, `Restoring the original home record failed: ${state.error?.message}`);
        equal(state.get(key), record, 'The durable home record must be restored exactly.');
        query('[data-save]').textContent = snapshot.saveText; query('[data-save]').className = snapshot.saveClass;
      } catch (error) { restoreErrors.push(error); }
    }
  }
  if (failure || restoreErrors.length) {
    const errors = [...(failure ? [failure] : []), ...restoreErrors];
    throw new AggregateError(errors, 'Home editor checks/restoration failed: ' + errors.map(error => error.message).join(' | '));
  }
  report.restored = true;
  return report;
}
