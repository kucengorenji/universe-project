import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import { AuthProvider, useAuth } from './auth.tsx';
import { GAME_URL } from './config.ts';
import { I18nProvider, useI18n } from './i18n.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { Worlds } from './pages/Worlds.tsx';
import './styles.css';

// The admin pages are their own chunk: players never download them.
const Admin = lazy(() => import('./pages/admin/Admin.tsx'));

function Header() {
  const { me, status, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  return (
    <header className="top">
      <div className="shell top__inner">
        <a className="top__brand" href="/">Aethergate<small>{t('app.title')}</small></a>
        {status === 'signedIn' ? (
          <nav className="top__nav" aria-label="Menu">
            <NavLink to="/" end>{t('nav.worlds')}</NavLink>
            {me?.isAdmin ? <NavLink to="/admin">{t('nav.admin')}</NavLink> : null}
          </nav>
        ) : null}
        <div className="top__right">
          <button type="button" className="pill pill--ghost pill--small" lang={lang === 'id' ? 'en' : 'id'} aria-label={t('lang.switch')} title={t('lang.switch')} onClick={() => setLang(lang === 'id' ? 'en' : 'id')}>{lang === 'id' ? 'EN' : 'ID'}</button>
          <a className="pill pill--ghost pill--small" href={`${GAME_URL}/play/`}>{t('nav.play')}</a>
          {status === 'signedIn' ? (
            <>
              <span className="top__user">{me?.email}</span>
              <button type="button" className="pill pill--small" onClick={() => signOut()}>{t('nav.signout')}</button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Routed() {
  const { status, me } = useAuth();
  const { t } = useI18n();
  if (status === 'loading') return <p className="shell page small muted">{t('common.loading')}</p>;
  if (status === 'signedOut') return <SignIn />;
  return (
    <Routes>
      <Route path="/" element={<Worlds />} />
      <Route path="/admin/*" element={me === null ? <p className="shell page small muted">{t('common.loading')}</p> : me.isAdmin
        ? <Suspense fallback={<p className="shell page small muted">{t('common.loading')}</p>}><Admin /></Suspense>
        : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Header />
          <main id="main"><Routed /></main>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>
);
