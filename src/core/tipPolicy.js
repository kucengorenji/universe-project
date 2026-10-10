// Pure rules for the onboarding tip card (no DOM, no clock of its own): which place a tip belongs
// to, and when a tip that is on screen has to step aside. `Tips` applies them to the real card.

/** The place or way of moving each tip explains. A tip is only ever shown, or kept, there. */
export const TIP_CONTEXT = {
  space: 'space',
  planet: 'planet',
  rover: 'planet',
  town: 'town.diorama',
  walk: 'town.walk',
  drive: 'town.drive',
  interior: 'town.interior',
  home: 'home'
};

/** Where the player is: a route mode, and for a town the view inside it. */
export const contextKey = (mode, view = 'diorama') => (mode === 'town' ? `town.${view}` : mode);

export const tipMatches = (id, context) => TIP_CONTEXT[id] === context;

export const TIP_MS = 11000;
/** After an action prompt goes away the tip waits this long before it comes back. */
export const RESUME_AFTER_MS = 1000;

/**
 * Whether the card is up right now. A tip that is hidden because of a prompt is not dismissed: it
 * keeps the time it had left and returns once the prompt has been gone for RESUME_AFTER_MS, as
 * long as the player is still where the tip belongs.
 */
export class TipPresence {
  constructor({ duration = TIP_MS, resumeAfter = RESUME_AFTER_MS } = {}) {
    this.duration = duration;
    this.resumeAfter = resumeAfter;
    this.id = null;
  }

  start(id, now) {
    this.id = id;
    this.remaining = this.duration;
    this.visible = true;
    this.since = now;
    this.freeSince = null;
  }

  clear() {
    this.id = null;
  }

  /** { visible, over }: `over` means the tip is finished (time ran out or the player left its place). */
  step({ now, suppressed, matches }) {
    if (!this.id) return { visible: false, over: false };
    if (!matches) { this.clear(); return { visible: false, over: true }; }
    if (suppressed) {
      if (this.visible) {
        this.remaining -= now - this.since;
        this.visible = false;
      }
      this.freeSince = null;
      if (this.remaining <= 0) { this.clear(); return { visible: false, over: true }; }
      return { visible: false, over: false };
    }
    if (!this.visible) {
      this.freeSince ??= now;
      if (now - this.freeSince < this.resumeAfter) return { visible: false, over: false };
      this.visible = true;
      this.since = now;
    }
    if (now - this.since >= this.remaining) { this.clear(); return { visible: false, over: true }; }
    return { visible: true, over: false };
  }
}
