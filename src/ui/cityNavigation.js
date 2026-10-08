import { t } from '../i18n/index.js';

const escape = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** One-click city access beside the current city, also usable without a mouse. */
export function cityNavigation(cities, current, attribute = 'data-focus-city') {
  if (cities.length < 2) return '';
  const i = Math.max(0, cities.findIndex(c => c.index === current));
  const button = (c, label) => `<button type="button" ${attribute}="${c.index}" aria-label="${escape(label || c.name)}">${escape(label || c.name)}</button>`;
  return `<nav class="city-navigation" aria-label="${t('cityNav.label')}">
    <div class="city-navigation__arrows">${button(cities[(i+cities.length-1)%cities.length],t('cityNav.prev'))}${button(cities[(i+1)%cities.length],t('cityNav.next'))}</div>
    <div class="city-navigation__list">${cities.map(c=>`<button type="button" ${attribute}="${c.index}" ${c.index===current?'aria-current="location" disabled':''}>
      <span>${escape(c.name)}</span><small>${t(c.style==='modern'?'style.modern':'style.fantasy')}</small></button>`).join('')}</div>
  </nav>`;
}
