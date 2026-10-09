import { NavLink, Route, Routes } from 'react-router';
import { Announcements } from './Announcements.tsx';
import { Events } from './Events.tsx';
import { Log } from './Log.tsx';
import { Overview } from './Overview.tsx';
import { PlayerDetail } from './PlayerDetail.tsx';
import { Players } from './Players.tsx';
import { WorldsAdmin } from './WorldsAdmin.tsx';

// Admin is an internal tool: Indonesian only.
const TABS: [string, string][] = [['', 'Ringkasan'], ['players', 'Pemain'], ['worlds', 'Dunia'], ['events', 'Event'], ['announcements', 'Pengumuman'], ['log', 'Log admin']];

export default function Admin() {
  return (
    <div className="shell page">
      <header className="page-head">
        <h1 className="page-title">Admin</h1>
        <nav className="seg" aria-label="Bagian admin" style={{ overflowX: 'auto', maxWidth: '100%' }}>
          {TABS.map(([path, label]) => (
            <NavLink key={path} to={`/admin${path ? `/${path}` : ''}`} end={!path} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:key" element={<PlayerDetail />} />
        <Route path="worlds" element={<WorldsAdmin />} />
        <Route path="events" element={<Events />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="log" element={<Log />} />
      </Routes>
    </div>
  );
}
