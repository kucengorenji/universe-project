// Full-screen cover used between modes. It hides the frame (or frames) where
// one mode is torn down and the next is built, which is the only moment the
// main thread may block. Everything that moves here is a CSS transform or
// opacity animation, so it keeps running on the compositor during that block.
//
// Kinds:
//   snapshot  the last frame of the old mode, cross-faded into the new one
//             (both modes frame the same view, so the swap reads as a zoom)
//   clouds    a white cloud bank the camera flies through (planet <-> town)
//   fade      plain dark fade (cold start, fallbacks)

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Overlay {
  constructor(root) {
    this.root = root;
    this.snap = root.querySelector('.cover__snap');
    this.label = root.querySelector('.cover__label');
    this.bar = root.querySelector('.cover__bar i');
    this.loading = root.querySelector('.cover__loading');
    this.kind = root.dataset.kind || 'fade';
    this.loadingTimer = null;
  }

  /** Copy the WebGL canvas right after it was drawn (same task, so no preserveDrawingBuffer). */
  capture(glCanvas) {
    this.snap.width = glCanvas.width;
    this.snap.height = glCanvas.height;
    this.snap.getContext('2d').drawImage(glCanvas, 0, 0);
  }

  async cover(kind = 'fade', { duration } = {}) {
    this.kind = kind;
    const root = this.root;
    root.dataset.kind = kind;
    root.hidden = false;
    root.classList.remove('is-on', 'is-revealing');
    root.style.setProperty('--cover-in', `${duration ?? (kind === 'snapshot' ? 0 : kind === 'clouds' ? 650 : 380)}ms`);
    await nextFrame();
    root.classList.add('is-on');
    if (kind !== 'snapshot') await wait(duration ?? (kind === 'clouds' ? 650 : 380));
    await nextFrame();
  }

  /** Show the spinner only if the swap takes long enough to notice. */
  showLoading(label = 'Memuat', delay = 220) {
    clearTimeout(this.loadingTimer);
    this.setProgress(null, label);
    this.loadingTimer = setTimeout(() => this.loading.classList.add('is-visible'), delay);
  }

  setProgress(frac, label) {
    if (label) this.label.textContent = label;
    this.root.classList.toggle('has-progress', frac !== null && frac !== undefined);
    if (frac !== null && frac !== undefined) this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  }

  hideLoading() {
    clearTimeout(this.loadingTimer);
    this.loading.classList.remove('is-visible');
  }

  async reveal({ duration } = {}) {
    this.hideLoading();
    const ms = duration ?? (this.kind === 'snapshot' ? 900 : this.kind === 'clouds' ? 1100 : 600);
    this.root.style.setProperty('--cover-out', `${ms}ms`);
    this.root.classList.add('is-revealing');
    this.root.classList.remove('is-on');
    await wait(ms);
    this.root.hidden = true;
    this.root.classList.remove('is-revealing');
  }
}
