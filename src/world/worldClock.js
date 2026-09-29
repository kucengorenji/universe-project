// Real-time offline policy retained for existing saves; menu pause freezes time.
export class WorldClock {
  constructor({ offset = 0, epoch = 1790000000, time = () => Date.now() / 1000, save = () => {} } = {}) {
    this.offset = offset;
    this.epoch = epoch;
    this.time = time;
    this.save = save;
    this.pausedAt = null;
  }
  now() { return (this.pausedAt ?? this.time()) - this.epoch + this.offset; }
  pause(paused) {
    if (paused && this.pausedAt === null) this.pausedAt = this.time();
    else if (!paused && this.pausedAt !== null) {
      this.offset -= Math.max(0, this.time() - this.pausedAt);
      this.pausedAt = null;
      this.save(this.offset);
    }
  }
  skip(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid time skip');
    this.offset += seconds;
    this.save(this.offset);
  }
}
