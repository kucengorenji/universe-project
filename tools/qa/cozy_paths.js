import { GroundPaint } from '../../src/modes/town/render/groundPaint.js';
import { createCozyPathAtlas } from '../../src/render/cozyPaths.js';

/** Run in the local game's browser via import('/tools/qa/cozy_paths.js'). */
export function validateCozyPathPaint() {
  const layout = {
    cityR: 100, modern: true, seed: 123,
    streets: [
      { kind: 'main', pts: [[-80, 0], [80, 0]], w: 8 },
      { kind: 'lane', pts: [[-40, -70], [-40, 70]], w: 5 }
    ],
    paths: [{ pts: [[60, 10], [60, 30]], w: 2 }],
    aprons: [{ kind: 'lot', x: -70, z: -30, yaw: 0, hw: 6, hd: 4 }],
    plaza: { x: 60, z: -30, r: 7 },
    rivers: [{ pts: [[-100, 35], [100, 35]], w: 3 }]
  };
  const checks = [], results = [];
  const expect = (name, pass, details = {}) => {
    const result = { name, pass, ...details }; checks.push(result);
    if (!pass) throw Error(JSON.stringify(result));
  };
  for (const modern of [false, true]) {
    const paint = new GroundPaint({ ...layout, modern }, { res: 1024, farRes: 1024, farRadius: 120 });
    try {
      for (const layerName of ['near', 'far']) {
        const layer = paint[layerName], canvas = layer.surface.image, ctx = canvas.getContext('2d');
        const pixel = (x, z) => Array.from(ctx.getImageData(
          Math.floor((x - layer.x0) / layer.size * canvas.width),
          Math.floor((z - layer.z0) / layer.size * canvas.height), 1, 1).data).slice(0, 3);
        for (const [name, x, z, channel] of [
          ['junction', -40, 0, 1], ['main paving', 30, 0, 1], ['earth lane', -40, -20, 0],
          ['garden path', 60, 20, 0], ['plaza', 60, -30, 2], ['lot', -70, -30, 1]
        ]) {
          const rgb = pixel(x, z);
          expect(`${modern ? 'modern' : 'fantasy'} ${layerName} ${name}`, rgb[channel] > 240 && rgb.filter((_, i) => i !== channel).every(v => v < 10), { rgb });
        }
        expect(`${layerName} grass remains unpaved`, pixel(0, -50).every(v => v === 0));
        expect(`${layerName} river clears overlapping street`, pixel(-40, 35).every(v => v === 0));
      }
      results.push({ modern, near: paint.near.tex.image.width, far: paint.far.tex.image.width });
    } finally { paint.dispose(); }
  }
  const first = createCozyPathAtlas(), second = createCozyPathAtlas();
  try {
    expect('surface master is deterministic', first.image.toDataURL() === second.image.toDataURL());
    expect('1024 square atlas with four metre repeats', first.image.width === 1024 && first.image.height === 1024 && first.userData.spanMetres === 4);
    expect('tone atlas uses linear data and mipmaps', first.colorSpace === '' && first.generateMipmaps);
  } finally { first.dispose(); second.dispose(); }
  return { pass: checks.every(c => c.pass), checks, results };
}
