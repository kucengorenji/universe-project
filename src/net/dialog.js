// A small modal card with a few choices, in the style of the intro card.
// Resolves with the chosen id; Escape picks the last (ghost) choice.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function askChoice({ eyebrow = '', title, text = '', choices }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'net-dialog';
    root.innerHTML = `
      <section class="net-dialog__card" role="dialog" aria-modal="true" aria-labelledby="netDialogTitle">
        ${eyebrow ? `<span class="card-block__eyebrow">${esc(eyebrow)}</span>` : ''}
        <h2 id="netDialogTitle" class="net-dialog__title">${esc(title)}</h2>
        ${text ? `<p class="net-dialog__text">${esc(text)}</p>` : ''}
        <div class="net-dialog__actions">${choices.map((c) => `<button type="button" class="pill${c.ghost ? ' pill--ghost' : ''}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>
      </section>`;
    const done = (id) => {
      window.removeEventListener('keydown', onKey, { capture: true });
      root.remove();
      resolve(id);
    };
    // The dialog owns the keyboard while it is open (the game must not move underneath).
    const onKey = (e) => {
      if (e.key === 'Escape') done(choices.at(-1).id);
      if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.preventDefault();
      e.stopImmediatePropagation();
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-choice]');
      if (b) done(b.dataset.choice);
    });
    window.addEventListener('keydown', onKey, { capture: true });
    document.body.append(root);
    root.querySelector('[data-choice]')?.focus({ preventScroll: true });
  });
}
