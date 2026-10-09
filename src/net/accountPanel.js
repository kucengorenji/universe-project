import { t } from '../i18n/index.js';
import { DASHBOARD_URL } from './config.js';

// "Account & cloud" in the pause menu: Google sign-in, cloud sync status and
// the usage-data switch. In inspect mode it only says whose world this is.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('net.ago.now');
  if (s < 3600) return t('net.ago.min', { count: Math.round(s / 60) });
  return new Date(ms).toLocaleString();
}

export class AccountPanel {
  constructor(root, { auth, sync, telemetry, inspect = null }) {
    Object.assign(this, { root, auth, sync, telemetry, inspect });
    this.busy = false;
    this.error = '';
    root.hidden = false;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-net="telemetry"]')) this.telemetry.setEnabled(e.target.checked);
    });
    auth.onChange(() => this.render());
    sync.listeners.add(() => this.render());
    // Times like "2 min ago" are refreshed whenever the menu opens.
    document.addEventListener('pause:open', () => this.render());
    this.render();
  }

  statusText() {
    const s = this.sync.status;
    if (s.state === 'syncing') return t('net.sync.syncing');
    if (s.state === 'synced') return t('net.sync.synced', { when: ago(s.at) });
    if (s.state === 'conflict') return t('net.sync.conflict');
    if (s.state === 'deleted') return t('net.sync.deleted');
    if (s.state === 'error') return s.error === 'auth' ? t('net.sync.auth') : s.error === 'too_large' ? t('net.sync.tooLarge') : t('net.sync.error');
    return t('net.sync.waiting');
  }

  render() {
    if (this.inspect) {
      const m = this.inspect.save.meta;
      this.root.innerHTML = `<h3>${t('net.account')}</h3>
        <p class="pause__note">${esc(t('net.inspect.panel', { seed: String(m.seed), when: new Date(this.inspect.save.updatedAt).toLocaleString() }))}</p>
        <div class="pause__row"><span>${t('net.inspect.exit')}</span><a class="pill pill--ghost pill--small" href="/play/">${t('net.inspect.leave')}</a></div>`;
      return;
    }
    const user = this.auth.user;
    const state = this.sync.status.state;
    const action = state === 'deleted' ? 'reupload' : 'sync';
    this.root.innerHTML = `<h3>${t('net.account')}</h3>
      ${user ? `
        <div class="pause__row"><span>${esc(user.email || user.displayName || '')}<small>${t('net.signedIn')}</small></span><button type="button" class="pill pill--ghost pill--small" data-net="signout">${t('net.signout')}</button></div>
        <div class="pause__row" role="status"><span>${t('net.sync.label')}<small>${esc(this.statusText())}</small></span><button type="button" class="pill pill--ghost pill--small" data-net="${action}" ${state === 'syncing' ? 'disabled' : ''}>${t(action === 'reupload' ? 'net.sync.reupload' : 'net.sync.now')}</button></div>
        <div class="pause__row"><span>${t('net.dashboard')}<small>${t('net.dashboard.hint')}</small></span><a class="pill pill--ghost pill--small" href="${esc(DASHBOARD_URL)}" target="_blank" rel="noopener">${t('net.dashboard.open')}</a></div>`
      : `
        <p class="pause__note">${t('net.pitch')}</p>
        <div class="pause__row"><span>${t('net.sync.label')}${this.error ? `<small>${esc(this.error)}</small>` : ''}</span><button type="button" class="pill pill--small" data-net="signin" ${this.busy ? 'disabled' : ''}>${t('net.signin')}</button></div>`}
      <label class="pause__row"><span>${t('net.telemetry')}<small>${t('net.telemetry.hint')}</small></span><input type="checkbox" class="switch" data-net="telemetry" ${this.telemetry.enabled ? 'checked' : ''}></label>`;
  }

  async onClick(e) {
    const b = e.target.closest('button[data-net]');
    if (!b) return;
    const act = b.dataset.net;
    if (act === 'signin') {
      this.busy = true;
      this.error = '';
      this.render();
      try { await this.auth.signIn(); }
      catch (err) {
        // Closing the popup is not an error worth showing.
        if (!/popup-closed|cancelled-popup/.test(err?.code || '')) this.error = t('net.signin.failed');
      } finally {
        this.busy = false;
        this.render();
      }
    } else if (act === 'signout') await this.auth.signOut();
    else if (act === 'sync') {
      this.sync.paused = false;
      await this.sync.check();
    } else if (act === 'reupload') await this.sync.check({ force: true });
  }
}
