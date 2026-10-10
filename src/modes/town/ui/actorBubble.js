// The speech bubble of a named townsperson: a small paper-coloured label over their head.
// Built with textContent only; it never takes the pointer or the focus.
export class ActorBubble {
  constructor({ parent, name, text }) {
    this.el = document.createElement('div');
    this.el.className = 'actor-bubble';
    this.el.hidden = true;
    const who = document.createElement('strong');
    who.textContent = name;
    const line = document.createElement('span');
    line.textContent = text;
    this.el.append(who, line);
    parent.appendChild(this.el);
  }

  /** `screen` is { x, y } in CSS pixels above the head, or null to hide. Announced once when it appears. */
  show(screen) {
    const on = !!screen;
    if (on && this.el.hidden) this.el.setAttribute('role', 'status');
    this.el.hidden = !on;
    if (on) this.el.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -100%)`;
  }

  dispose() { this.el.remove(); }
}
