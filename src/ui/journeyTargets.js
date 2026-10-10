import { t } from '../i18n/index.js';

// Which planet and which city the First Journey points at right now. The highlight is an
// overlay on rows and banners that already exist; it never changes which one is selected.

/**
 * { planet, city } as indexes or null. The home planet is the target while flying there (J1) and
 * when coming back (J6, away); the hometown while choosing where to land (J2) and when coming back.
 */
export function journeyTargets(journey) {
  if (!journey || journey.done) return { planet: null, city: null };
  const { stage } = journey;
  const away = stage === 'j6' && journey.away;
  return {
    planet: stage === 'j1' || away ? journey.homePlanet : null,
    city: stage === 'j2' || away ? journey.homeCity : null
  };
}

/** Put the house badge on the matching rows (and only those); `labelFor(el)` is the text for the tooltip. */
export function markRows(elements, indexOf, target, text) {
  for (const el of elements) {
    const on = target !== null && target !== undefined && indexOf(el) === target;
    el.classList.toggle('is-journey', on);
    if (on) el.title = text; else if (el.classList.contains('was-journey')) el.removeAttribute('title');
    el.classList.toggle('was-journey', on);
  }
}

export const planetText = (journey) => t('journey.marker.planet', { planet: journey.names.planet ?? '' });
export const cityText = (journey) => t('journey.marker.city', { city: journey.names.city ?? '' });
