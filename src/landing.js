import './landing.css';
import { fetchAnnouncements, showNotice, unseen } from './net/announcements.js';

// Existing bookmarks keep their world route when the homepage becomes the landing page.
if (/^#\/?(?:space|planet|town|home)(?:\/|$)/.test(location.hash)) {
  location.replace(`/play/${location.search}${location.hash}`);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Screenshot tabs. Without JS the first shot of each level and all text stay readable.
for (const viewer of document.querySelectorAll('[data-viewer]')) {
  const tabs = [...viewer.querySelectorAll('[role="tab"]')];
  if (!tabs.length) continue;
  const frame = viewer.querySelector('.viewer-frame'), img = frame.querySelector('img');
  const title = frame.querySelector('[data-cap-title]'), desc = frame.querySelector('[data-cap-desc]'), count = frame.querySelector('[data-count]');
  const pad = n => String(n).padStart(2, '0');
  let current = 0, token = 0;
  tabs.forEach((tab, i) => { tab.id ||= `${viewer.closest('.level').id}-tab-${i}`; tab.tabIndex = i ? -1 : 0; });
  const preload = tab => { new Image().src = tab.dataset.src; };

  function select(i, { focus = false } = {}) {
    if (i === current && img.getAttribute('src') === tabs[i].dataset.src) return;
    const tab = tabs[i], mine = ++token;
    tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(j === i)); t.tabIndex = j === i ? 0 : -1; });
    if (focus) tab.focus();
    current = i;
    frame.setAttribute('aria-labelledby', tab.id);
    title.textContent = tab.dataset.title; desc.textContent = tab.dataset.desc;
    if (count) count.textContent = `${pad(i + 1)} / ${pad(tabs.length)}`;
    // Swap once the new frame has decoded, so the viewer never flashes empty.
    const next = new Image();
    next.src = tab.dataset.src;
    if (!reduceMotion) img.classList.add('is-swapping');
    (next.decode ? next.decode() : Promise.resolve()).catch(() => {}).then(() => {
      if (mine !== token) return;
      img.src = tab.dataset.src; img.alt = tab.dataset.alt;
      requestAnimationFrame(() => img.classList.remove('is-swapping'));
    });
  }
  frame.setAttribute('aria-labelledby', tabs[0].id);
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('pointerenter', () => preload(tab));
    tab.addEventListener('focus', () => preload(tab));
    tab.addEventListener('keydown', e => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); select((i + k + tabs.length) % tabs.length, { focus: true }); }
      else if (e.key === 'Home') { e.preventDefault(); select(0, { focus: true }); }
      else if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, { focus: true }); }
    });
  });
}

// The level rail marks the level being read. On narrow screens it scrolls sideways, so keep the active pill in view.
const links = new Map([...document.querySelectorAll('[data-level-link]')].map(a => [a.dataset.levelLink, a]));
const rail = document.querySelector('[data-rail]');
if (links.size && 'IntersectionObserver' in window) {
  const spy = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a, id) => a.setAttribute('aria-current', String(id === e.target.dataset.level)));
      const active = links.get(e.target.dataset.level);
      if (rail && rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: active.offsetLeft - 16, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, { rootMargin: '-35% 0px -60% 0px' });
  document.querySelectorAll('.level').forEach(el => spy.observe(el));
}

// Announcements from the admin dashboard, under the header. The game shows its own.
fetchAnnouncements('landing').then(items => {
  const fresh = unseen(items);
  if (!fresh.length) return;
  const locale = document.documentElement.lang === 'en' ? 'en' : 'id'; // the landing page is written in Indonesian
  const host = document.createElement('div');
  host.className = 'landing-notices shell';
  document.querySelector('.site-header')?.after(host);
  for (const a of fresh.slice(0, 2)) showNotice(host, a, { locale, closeLabel: locale === 'id' ? 'Tutup' : 'Close', className: 'landing-notice' });
});
