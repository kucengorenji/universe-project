/**
 * Vertex data for a mesh built piece by piece: floats go straight into a growing Float32Array. A plain JS
 * array of numbers costs 8 bytes a float (and doubles while it grows); this is 4 and bit-identical, because
 * a Float32Array rounds the same way the old Float32BufferAttribute copy did.
 */
export class FloatBuffer {
  constructor(capacity = 1 << 16) {
    this.array = new Float32Array(capacity);
    this.length = 0;
  }

  add3(x, y, z) {
    if (this.length + 3 > this.array.length) {
      const grown = new Float32Array(this.array.length * 2);
      grown.set(this.array);
      this.array = grown;
    }
    const a = this.array, i = this.length;
    a[i] = x; a[i + 1] = y; a[i + 2] = z;
    this.length = i + 3;
  }

  /** An exactly sized copy; the growth buffer can then be dropped. */
  finish() { return this.array.slice(0, this.length); }
}
