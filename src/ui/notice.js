import { NoticeBoard } from './noticePolicy.js';

// The one transient message slot, centred under the objective bar (or under the top bar when there is
// no objective). Only one message shows at a time; noticePolicy.js decides who wins. The element is
// created on first use and the text is always set with textContent.
const board = new NoticeBoard();
let el = null;
let timer = null;
let watch = null;

const visible = (node) => {
  if (!node || node.closest('[hidden]')) return null;
  const rect = node.getBoundingClientRect();
  return rect.width && rect.height ? rect : null;
};

/** top = objective bottom + 8 px; without an objective, 12 px under the top bar (where the objective would sit). */
export function noticeTop() {
  const objective = visible(document.querySelector('.journey-hud'));
  if (objective) return Math.round(objective.bottom + 8);
  let bottom = 0;
  for (const bar of document.querySelectorAll('.topbar')) bottom = Math.max(bottom, visible(bar)?.bottom ?? 0);
  return Math.round(bottom + 12) || 76;
}

export function placeNotice() {
  if (el && !el.hidden) el.style.top = `${noticeTop()}px`;
}

function create() {
  el = document.createElement('div');
  el.id = 'toastNotice';
  el.className = 'notice';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  window.addEventListener('resize', placeNotice);
}

function apply() {
  clearTimeout(timer);
  const now = performance.now();
  const notice = board.at(now);
  if (!el) return;
  if (!notice) {
    el.hidden = true;
    clearInterval(watch);
    watch = null;
    return;
  }
  el.textContent = notice.title ? `${notice.title} · ${notice.message}` : notice.message; // the slot is two lines at most
  el.dataset.kind = notice.kind;
  el.hidden = false;
  placeNotice();
  watch ??= setInterval(placeNotice, 250);
  timer = setTimeout(apply, Math.max(16, notice.until - now));
}

/** Show a message in the slot: { message, title?, kind: 'saved'|'stage'|'info'|'mission', ms? }. A title is read first, then a dot. */
export function showNotice(notice) {
  if (typeof document === 'undefined') return 'dropped';
  if (!el) create();
  const result = board.post(notice, performance.now());
  if (result === 'show') {
    el.classList.remove('is-in');
    void el.offsetWidth; // restart the entrance
    el.classList.add('is-in');
  }
  apply();
  return result;
}

/** A save problem or a pending save is on the objective bar: 'error' | 'pending' | 'none'. */
export function setNoticeBlock(block) {
  if (board.block === block) return;
  board.setBlock(block);
  apply();
}

/** For QA: what is in the slot and where. */
export function noticeState() {
  const rect = el && !el.hidden ? el.getBoundingClientRect() : null;
  return { text: rect ? el.textContent : null, kind: rect ? el.dataset.kind : null, rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null, block: board.block };
}
