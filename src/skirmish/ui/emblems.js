import { CLASSES, FACTIONS } from '../units/soldierLook.js';

// Inline SVG emblems of the war-notebook UI: the faction shields (a star for the Federation,
// crossed sabres for the Empire) and class shields with the class code. Shared by the HUD and
// the maps; colours come from soldierLook.FACTIONS.

export const SHORT = { ...Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.short])), tank: 'TK', bunker: 'BK' };
export const CLASS_NAME = { ...Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, v.label])), tank: 'Tank', bunker: 'Bunker' };

const INK = '#2a2119';
const PAPER = '#f4ecd8';
const SHIELD = 'M4 3H36V19C36 30 29 37.5 20 42 11 37.5 4 30 4 19Z';
const INNER = 'M7.5 6.5H32.5V19C32.5 28 27 34 20 38 13 34 7.5 28 7.5 19Z';

const MARKS = {
  fed: `<path d="M20 11.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z" fill="${PAPER}"/>`,
  imp: `<g stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round"><path d="M12.5 12.5l15 16M27.5 12.5l-15 16"/></g><g fill="${PAPER}"><circle cx="12" cy="29" r="2"/><circle cx="28" cy="29" r="2"/></g>`
};

/** A shield in the faction's colour: its mark, or a class code (SC, ST, …) when given. */
export function shield(side, code = '', { title = '' } = {}) {
  const fill = FACTIONS[side]?.flag || '#777';
  const mark = code
    ? `<text x="20" y="25.5" text-anchor="middle" font-family="'Courier Prime', ui-monospace, monospace" font-weight="700" font-size="13" fill="${PAPER}" letter-spacing="-0.5">${code}</text>`
    : MARKS[side] || '';
  return `<svg class="shield" viewBox="0 0 40 46" aria-hidden="${title ? 'false' : 'true'}" role="img">${title ? `<title>${title}</title>` : ''}<path d="${SHIELD}" fill="${fill}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="${INNER}" fill="none" stroke="${PAPER}" stroke-opacity="0.55" stroke-width="1.1"/>${mark}</svg>`;
}

/** The class shield of a unit. */
export const unitShield = (u) => shield(u.side, SHORT[u.cls] || '?');

/** A small open eye: "this enemy can see you". */
export const EYE = `<svg class="eye" viewBox="0 0 24 14" aria-hidden="true"><path d="M1.5 7C5 1.8 9 1 12 1s7 .8 10.5 6C19 12.2 15 13 12 13S5 12.2 1.5 7Z" fill="${PAPER}" stroke="#a8322d" stroke-width="2"/><circle cx="12" cy="7" r="3.2" fill="#a8322d"/></svg>`;
