const escape = value => String(value).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** One-click city access beside the current city, also usable without a mouse. */
export function cityNavigation(cities, current, attribute = 'data-focus-city') {
  if (cities.length < 2) return '';
  const i = Math.max(0, cities.findIndex(c => c.index === current));
  const button = (c, label) => `<button type="button" ${attribute}="${c.index}" aria-label="${escape(label || c.name)}">${escape(label || c.name)}</button>`;
  return `<nav class="city-navigation" aria-label="Pindah kota">
    <div class="city-navigation__arrows">${button(cities[(i+cities.length-1)%cities.length],'← Kota sebelumnya')}${button(cities[(i+1)%cities.length],'Kota berikutnya →')}</div>
    <div class="city-navigation__list">${cities.map(c=>`<button type="button" ${attribute}="${c.index}" ${c.index===current?'aria-current="location" disabled':''}>
      <span>${escape(c.name)}</span><small>${c.style==='modern'?'Modern':'Fantasi'}</small></button>`).join('')}</div>
  </nav>`;
}
