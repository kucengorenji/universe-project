// Pure rules for the one transient message slot under the objective bar: who wins when two
// messages want it, what a persistent save problem silences, and which mission toasts the First
// Journey already says. `notice.js` draws it; nothing here touches the DOM or the clock.

/** Higher wins the slot. Save errors and a pending save live in the objective bar, not here: they block. */
export const RANK = { saved: 3, stage: 2, info: 2, mission: 1 };
const rankOf = (kind) => RANK[kind] ?? RANK.info;

/** Mission events whose action the First Journey toasts itself (entering the home, switching a light on). */
export const JOURNEY_ACTION_EVENTS = new Set(['enter_house', 'light_on']);

export const missionToastSuppressed = ({ event, journeyActive }) => Boolean(journeyActive) && JOURNEY_ACTION_EVENTS.has(event);

export const QUEUE_LIMIT = 3;
export const QUEUE_TTL_MS = 6000;
export const MAX_MS = { saved: 4000, stage: 2800, info: 2800, mission: 2800 };

/** `error` drops every message; `pending` drops all but the save confirmation; `none` drops nothing. */
const blocks = (block, kind) => block === 'error' || (block === 'pending' && rankOf(kind) < RANK.saved);

export class NoticeBoard {
  constructor({ limit = QUEUE_LIMIT, ttl = QUEUE_TTL_MS } = {}) {
    this.limit = limit;
    this.ttl = ttl;
    this.block = 'none';
    this.current = null;
    this.queue = [];
  }

  /** A message wants the slot. Returns what happened: 'show' (now on screen), 'queued' or 'dropped'. */
  post(notice, now) {
    const kind = notice.kind ?? 'info';
    if (blocks(this.block, kind)) return 'dropped';
    const entry = { ...notice, kind, until: 0, postedAt: now, ms: Math.min(notice.ms ?? MAX_MS[kind] ?? 2800, kind === 'saved' ? 4000 : 2800) };
    this.expire(now);
    if (!this.current || rankOf(kind) >= rankOf(this.current.kind)) {
      this.current = { ...entry, until: now + entry.ms };
      return 'show';
    }
    if (this.queue.length >= this.limit) {
      // the lowest, oldest message makes room; a message that is itself the lowest is the one to go
      const lowest = this.queue.reduce((a, b) => (rankOf(b.kind) < rankOf(a.kind) ? b : a));
      if (rankOf(lowest.kind) > rankOf(kind)) return 'dropped';
      this.queue.splice(this.queue.indexOf(lowest), 1);
    }
    this.queue.push(entry);
    return 'queued';
  }

  /**
   * The persistent save state changed. Returns true when the message on screen had to go. Only an error
   * removes it: a stage toast is always followed by its own save, which is pending for a moment, and
   * must not vanish because of that.
   */
  setBlock(block) {
    this.block = block;
    this.queue = this.queue.filter((n) => !blocks(block, n.kind));
    if (this.current && block === 'error') {
      this.current = null;
      return true;
    }
    return false;
  }

  expire(now) {
    if (this.current && now >= this.current.until) this.current = null;
    if (!this.current) {
      this.queue = this.queue.filter((n) => now - n.postedAt < this.ttl);
      // highest rank first, then the one that waited longest
      const next = [...this.queue].sort((a, b) => rankOf(b.kind) - rankOf(a.kind) || a.postedAt - b.postedAt)[0];
      if (next) {
        this.queue.splice(this.queue.indexOf(next), 1);
        this.current = { ...next, until: now + next.ms };
      }
    }
  }

  /** What should be on screen at `now`: the notice or null. */
  at(now) {
    this.expire(now);
    return this.current;
  }
}
