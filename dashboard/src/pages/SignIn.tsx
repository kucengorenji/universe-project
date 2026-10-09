import { useState } from 'react';
import { useAuth } from '../auth.tsx';
import { DEV_AUTH } from '../config.ts';
import { useI18n } from '../i18n.tsx';

export function SignIn() {
  const { signIn, devSignIn, error } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('admin@example.com');
  return (
    <div className="shell">
      <section className="signin">
        <h1 className="signin__title">{t('signin.title')}</h1>
        <p className="lead">{t('signin.lead')}</p>
        <div className="pill-row"><button type="button" className="pill" onClick={() => signIn()}>{t('signin.button')}</button></div>
        {error ? <p className="notice notice--error" role="alert">{t('signin.failed', { error })}</p> : null}
        <p className="lead">{t('signin.anon')}</p>
        {DEV_AUTH ? (
          <form className="dev-signin" onSubmit={(e) => { e.preventDefault(); devSignIn(email.trim()); }}>
            <label htmlFor="devEmail">{t('signin.dev')}</label>
            <input id="devEmail" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="pill pill--ghost pill--small">OK</button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
