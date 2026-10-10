import { inflateSync, deflateSync, crc32 } from 'node:zlib';

// A small PNG reader/writer for 8-bit, non-interlaced images (grey, RGB, RGBA) so derived
// textures can be made with Node alone: no install, no platform tool, same bytes every run.

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let p = 8, header = null;
  const idat = [], chunks = [];
  while (p < buffer.length) {
    const length = buffer.readUInt32BE(p), type = buffer.toString('ascii', p + 4, p + 8), body = buffer.subarray(p + 8, p + 8 + length);
    chunks.push({ type, body });
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    p += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0 || !(header.color in CHANNELS)) throw new Error(`unsupported PNG: ${JSON.stringify(header)}`);
  const channels = CHANNELS[header.color], stride = header.width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const data = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y ? data[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? data[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      data[y * stride + x] = v & 255;
    }
  }
  return { ...header, channels, data, chunks: chunks.map((c) => c.type) };
}

const chunk = (type, body) => {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

/** Adaptive filtering (lowest sum of absolute residuals per row, like libpng) and zlib level 9. Deterministic. */
export function encodePng({ width, height, color, data }, { srgb = false } = {}) {
  const channels = CHANNELS[color], stride = width * channels;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let best = null;
    for (let filter = 0; filter <= 4; filter++) {
      const line = Buffer.alloc(stride + 1);
      line[0] = filter;
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const raw = data[y * stride + x];
        const a = x >= channels ? data[y * stride + x - channels] : 0;
        const b = y ? data[(y - 1) * stride + x] : 0;
        const c = x >= channels && y ? data[(y - 1) * stride + x - channels] : 0;
        let predicted = 0;
        if (filter === 1) predicted = a;
        else if (filter === 2) predicted = b;
        else if (filter === 3) predicted = (a + b) >> 1;
        else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (raw - predicted) & 255;
        line[x + 1] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (!best || cost < best.cost) best = { cost, line };
    }
    rows.push(best.line);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = color;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), ...(srgb ? [chunk('sRGB', Buffer.from([0]))] : []), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Halve (or divide by `factor`) the size with a box filter: every output sample is the rounded mean of the
 * factor x factor block, per channel. This is exactly what the town does at run time with the painted
 * surfaces (paintedStyle.compactTownPaintedSurfaces) and what mip level 1 of a GPU texture is.
 */
export function boxDownsample({ width, height, color, data }, factor) {
  if (width % factor || height % factor) throw new RangeError('the size must divide by the factor');
  const channels = CHANNELS[color], w = width / factor, h = height / factor, out = Buffer.alloc(w * h * channels), n = factor * factor;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < channels; c++) {
    let sum = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) sum += data[((y * factor + dy) * width + x * factor + dx) * channels + c];
    out[(y * w + x) * channels + c] = Math.round(sum / n);
  }
  return { width: w, height: h, color, data: out };
}
