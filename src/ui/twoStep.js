// "Click again to confirm" without a browser dialog: the first press arms an action,
// a second press on the same action within `ms` confirms it. Anything else disarms.
export class TwoStepConfirm {
  constructor({ ms = 8000, now = () => performance.now() } = {}) {
    this.ms = ms;
    this.now = now;
    this.id = null;
    this.at = 0;
  }

  /** true when this press confirms an armed action; false when it only armed it. */
  press(id) {
    const confirmed = this.id === id && this.now() - this.at <= this.ms;
    if (confirmed) this.cancel();
    else { this.id = id; this.at = this.now(); }
    return confirmed;
  }

  get armed() { return this.id !== null && this.now() - this.at <= this.ms ? this.id : null; }

  cancel() { this.id = null; }
}
