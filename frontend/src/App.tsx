import { useState } from 'react';
import { DevicesPage } from './components/DevicesPage';
import { LoginPage } from './components/LoginPage';
import { OverviewPage } from './components/OverviewPage';
import { useAuth } from './hooks/useAuth';

const TABS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'devices', label: 'Geräte' },
  { id: 'scripts', label: 'Skripte' },
  { id: 'patches', label: 'Patches' },
  { id: 'audit', label: 'Audit' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const PLACEHOLDER: Record<Exclude<TabId, 'overview' | 'devices'>, string> = {
  scripts: 'Skript-Bibliothek und Remote-Shell kommen in Phase 3.',
  patches: 'Patch-Management kommt in Phase 4.',
  audit: 'Der Audit-Log-Viewer kommt in Phase 3.',
};

export default function App() {
  const { user, status, login, logout } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');
  // Lifted so the overview cards can deep-link into a device's detail view.
  const [openDevice, setOpenDevice] = useState<number | null>(null);

  if (status === 'loading') {
    return <div className="app-loading">Lade…</div>;
  }
  if (status === 'anon' || !user) {
    return <LoginPage onLogin={login} />;
  }

  const jumpToDevice = (id: number) => {
    setOpenDevice(id);
    setTab('devices');
  };

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
              onClick={() => {
                setTab(t.id);
                if (t.id !== 'devices') setOpenDevice(null);
              }}
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
        {tab === 'overview' ? (
          <OverviewPage onOpenDevice={jumpToDevice} />
        ) : tab === 'devices' ? (
          <DevicesPage
            isAdmin={user.role === 'admin'}
            selected={openDevice}
            onSelect={setOpenDevice}
          />
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
