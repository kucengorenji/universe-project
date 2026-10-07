import test from 'node:test';
import assert from 'node:assert/strict';
import { DataArrayTexture, Vector3 } from 'three';
import { TOWN_PAINT_SURFACES, compactTownPaintedSurfaces,
  patchTownPaintedProps, patchTownPaintedGround } from '../src/modes/town/render/paintedStyle.js';
import { SURFACE } from '../src/skirmish/battlefield/envKit.js';

function paintedTiles() {
  const texture = new DataArrayTexture(new Uint8Array(22 * 4), 1, 1, 22);
  texture.userData.means = Array.from({ length: 22 }, () => new Vector3(0.5, 0.5, 0.5));
  return texture;
}

function shader() {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>\n// roof palette and vehicle paint\n#include <project_vertex>',
    fragmentShader: '#include <common>\nvoid main() {\n// night glass and authored ground colour\n#include <alphatest_fragment>\n// night emissive\n#include <tonemapping_fragment>\n}'
  };
}

test('painted town semantics preserve plain gameplay colours and match the Skirmish surfaces', () => {
  assert.equal(TOWN_PAINT_SURFACES[0], -1, 'glass, vehicles and people opt out');
  assert.equal(TOWN_PAINT_SURFACES[1], SURFACE.plaster);
  assert.equal(TOWN_PAINT_SURFACES[2], SURFACE.brick);
  assert.equal(TOWN_PAINT_SURFACES[3], SURFACE.timber);
  assert.equal(TOWN_PAINT_SURFACES[4], SURFACE.stone);
  assert.equal(TOWN_PAINT_SURFACES[5], SURFACE.roof_tile);
  assert.equal(TOWN_PAINT_SURFACES[8], SURFACE.bark);
  assert.equal(TOWN_PAINT_SURFACES[9], SURFACE.cobble);
  assert.equal(TOWN_PAINT_SURFACES[12], SURFACE.grass);
});

test('compacting the actual painted tiles keeps layers separate and reduces texel memory fourfold', () => {
  const bytes = new Uint8Array(4 * 4 * 2 * 4);
  for (let i = 0; i < 16; i++) bytes.set([40, 80, 120, 255], i * 4);
  for (let i = 16; i < 32; i++) bytes.set([200, 160, 80, 255], i * 4);
  const source = new DataArrayTexture(bytes, 4, 4, 2);
  source.userData.means = [new Vector3(0.1, 0.2, 0.3), new Vector3(0.7, 0.5, 0.2)];
  const compact = compactTownPaintedSurfaces(source, 2);
  assert.equal(compact.image.data.byteLength, source.image.data.byteLength / 4);
  assert.deepEqual(Array.from(compact.image.data.slice(0, 4)), [40, 80, 120, 255]);
  assert.deepEqual(Array.from(compact.image.data.slice(16, 20)), [200, 160, 80, 255]);
  assert.equal(compact.userData.means, source.userData.means);
  assert.throws(() => compactTownPaintedSurfaces(source, 3), RangeError);
  source.dispose(); compact.dispose();
});

test('painted prop shader composes with roof and night colour logic while distant LODs skip expensive detail', () => {
  const surfaces = paintedTiles(), hatch = {};
  const near = shader();
  patchTownPaintedProps(near, surfaces, { hatch });
  assert.match(near.vertexShader, /roof palette and vehicle paint/);
  assert.match(near.fragmentShader, /night glass and authored ground colour/);
  assert.match(near.fragmentShader, /night emissive/);
  assert.match(near.fragmentShader, /townDetail > 0\.001/);
  assert.match(near.fragmentShader, /vTownPaintSurface > 0\.5/);
  assert.match(near.fragmentShader, /Triplanar/);
  assert.equal(near.uniforms.uTownHatch.value, hatch);
  const middle = shader();
  patchTownPaintedProps(middle, surfaces, { lod: 1 });
  assert.doesNotMatch(middle.fragmentShader, /Triplanar|uTownHatch/);
  const far = shader(), original = structuredClone(far);
  patchTownPaintedProps(far, surfaces, { lod: 2 });
  assert.deepEqual(far, original);
  const atlas = shader();
  atlas.vertexShader += '\nattribute vec3 surface;';
  patchTownPaintedProps(atlas, surfaces, { hatch });
  assert.equal(atlas.vertexShader.match(/attribute vec3 surface;/g).length, 1);
  surfaces.dispose();
});

test('cardinal painted faces sample the same projection once and retain the pitched-face blend', () => {
  const surfaces = paintedTiles();
  const compiled = shader();
  patchTownPaintedProps(compiled, surfaces, { hatch: {} });
  const fragment = compiled.fragmentShader;
  for (const [axis, coordinates] of [
    ['x', 'vec2(vTownPaintPos.z, -vTownPaintPos.y)'],
    ['y', 'vTownPaintPos.xz'],
    ['z', 'vec2(vTownPaintPos.x, -vTownPaintPos.y)']
  ]) {
    assert.ok(fragment.includes(`if (w.${axis} > 0.999) pigment = townPaint(${coordinates}, semantic);`),
      `${axis}: the dominant face has one matching sample`);
    assert.ok(fragment.includes(`townPaint(${coordinates}, semantic) * w.${axis}`),
      `${axis}: mixed roof/bevel weights still use the same projection`);
  }
  assert.ok(fragment.indexOf('townDetail > 0.001') < fragment.indexOf('if (w.x > 0.999)'),
    'the distance gate skips both the fast path and mixed sampling');
  assert.match(fragment, /texture2D\(uTownHatch, plane \* 0\.58\)/, 'pencil style remains intact');
  surfaces.dispose();
});

test('ground paint selects its own surface mask after authored town colour and skips detail beyond its distance band', () => {
  const surfaces = paintedTiles();
  const near = { surface: {}, x0: -100, z0: -100, size: 200 };
  const far = { surface: {}, x0: -1000, z0: -1000, size: 2000 };
  const ground = shader();
  patchTownPaintedGround(ground, surfaces, { near, far, modern: true });
  assert.match(ground.fragmentShader, /night glass and authored ground colour/);
  assert.match(ground.fragmentShader, /townGroundDetail > 0\.001/);
  assert.match(ground.fragmentShader, /weights\.r > 0\.5 \? 15/);
  assert.equal(ground.uniforms.uTownPaintNearMask.value, near.surface);
  assert.equal(ground.uniforms.uTownPaintFarMask.value, far.surface);
  assert.deepEqual(ground.uniforms.uTownPaintNearRect.value.toArray(), [-100, -100, 200]);
  surfaces.dispose();
});
