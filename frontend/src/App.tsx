import { useState } from 'react';
import { DevicesPage } from './components/DevicesPage';
import { LoginPage } from './components/LoginPage';
import { useAuth } from './hooks/useAuth';

const TABS = [
  { id: 'devices', label: 'Geräte' },
  { id: 'scripts', label: 'Skripte' },
  { id: 'patches', label: 'Patches' },
  { id: 'audit', label: 'Audit' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PLACEHOLDER: Record<Exclude<TabId, 'devices'>, string> = {
  scripts: 'Skript-Bibliothek und Remote-Shell kommen in Phase 3.',
  patches: 'Patch-Management kommt in Phase 4.',
  audit: 'Der Audit-Log-Viewer kommt in Phase 3.',
};

export default function App() {
  const { user, status, login, logout } = useAuth();
  const [tab, setTab] = useState<TabId>('devices');

  if (status === 'loading') {
    return <div className="app-loading">Lade…</div>;
  }
  if (status === 'anon' || !user) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">
          rxf-sys <span className="accent">RMM</span>
        </span>
        <nav className="tab-nav" aria-label="Bereiche">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="username">{user.username}</span>
          <button className="ghost" onClick={() => void logout()}>
            Abmelden
          </button>
        </div>
      </header>
      <main className="app-main">
        {tab === 'devices' ? (
          <DevicesPage />
        ) : (
          <div className="empty-state">
            <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
            <p>{PLACEHOLDER[tab]}</p>
          </div>
        )}
      </main>
    </div>
  );
}
