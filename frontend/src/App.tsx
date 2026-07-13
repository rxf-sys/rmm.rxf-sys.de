import { useCallback, useEffect, useState } from 'react';
import { AdminPage } from './components/AdminPage';
import { AlertsPage } from './components/AlertsPage';
import { AuditPage } from './components/AuditPage';
import { AutomationPage } from './components/AutomationPage';
import { CommandPalette } from './components/CommandPalette';
import { DeviceDetail } from './components/DeviceDetail';
import { DevicesPage } from './components/DevicesPage';
import { DocsPage } from './components/DocsPage';
import { EnrollModal } from './components/EnrollModal';
import { Header } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { OverviewPage } from './components/OverviewPage';
import { PatchesPage } from './components/PatchesPage';
import { PersonsPage } from './components/PersonsPage';
import { ScriptsPage } from './components/ScriptsPage';
import { Sidebar, type PageId } from './components/Sidebar';
import { useAuth } from './hooks/useAuth';
import { useFleet } from './hooks/useFleet';
import { useTheme } from './hooks/useTheme';

const PAGE_LABEL: Record<PageId, string> = {
  overview: 'Übersicht',
  devices: 'Geräte',
  persons: 'Personen',
  alerts: 'Alarm-Center',
  patches: 'Patch-Management',
  scripts: 'Skripte',
  automation: 'Automatisierung',
  docs: 'Dokumentation',
  audit: 'Audit-Log',
  admin: 'Administration',
};

const FAV_KEY = 'ryntra-favorites';

function loadFavorites(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

export default function App() {
  const { user, status, login, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const fleet = useFleet();

  const [page, setPage] = useState<PageId>('overview');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // The fleet poller mounts before login, so its first fetch 401s and the
  // next tick is 30 s out. Refetch immediately once a session exists.
  const userId = user?.id ?? null;
  const refresh = fleet.refresh;
  useEffect(() => {
    if (userId !== null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ⌘K / Ctrl+K toggles the palette; Esc closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setEnrollOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'loading') return <div className="app-loading">Lade…</div>;
  if (status === 'anon' || !user) return <LoginPage onLogin={login} />;

  const isAdmin = user.role === 'admin';
  // Techniker: hands-on device work (jobs, scripts, patches, remote, enrollment).
  const isOperator = isAdmin || user.role === 'techniker';
  const goPage = (p: PageId) => {
    setPage(p);
    setDetailId(null);
    setPaletteOpen(false);
    setNavOpen(false);
  };
  const openDevice = (id: number) => {
    setDetailId(id);
    setPage('devices');
    setPaletteOpen(false);
    setNavOpen(false);
  };

  const openAlerts = fleet.alerts.filter((a) => a.resolved_at === null).length;
  const openPatches = Object.values(fleet.patchSummary).reduce((a, s) => a + s.pending, 0);

  const detailDevice = detailId !== null ? fleet.devices.find((d) => d.id === detailId) : undefined;
  const crumbCur = detailId !== null ? (detailDevice?.hostname ?? `Gerät ${detailId}`) : PAGE_LABEL[page];
  const crumbPre = detailId !== null ? 'Ryntra / Geräte / ' : 'Ryntra / ';

  return (
    <div className={navOpen ? 'app-shell nav-open' : 'app-shell'}>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <Sidebar
        page={page}
        onNavigate={goPage}
        user={user}
        devices={fleet.devices}
        favorites={favorites}
        openAlerts={openAlerts}
        openPatches={openPatches}
        onOpenDevice={openDevice}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={() => void logout()}
      />
      <div className="main">
        <Header
          crumbPre={crumbPre}
          crumbCur={crumbCur}
          openAlerts={openAlerts}
          canEnroll={isOperator}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenAlerts={() => goPage('alerts')}
          onOpenEnroll={() => setEnrollOpen(true)}
          onToggleNav={() => setNavOpen((o) => !o)}
        />
        <div className="content">
          {detailId !== null ? (
            <DeviceDetail
              deviceId={detailId}
              isAdmin={isAdmin}
              isOperator={isOperator}
              favorite={favorites.includes(detailId)}
              onToggleFavorite={() => toggleFavorite(detailId)}
              onBack={() => setDetailId(null)}
              onDeleted={() => {
                setDetailId(null);
                fleet.refresh();
              }}
              onLogout={logout}
            />
          ) : page === 'overview' ? (
            <OverviewPage
              fleet={fleet}
              user={user}
              onOpenDevice={openDevice}
              onNavigate={goPage}
              onOpenEnroll={() => setEnrollOpen(true)}
              canEnroll={isOperator}
            />
          ) : page === 'devices' ? (
            <DevicesPage
              devices={fleet.devices}
              patchSummary={fleet.patchSummary}
              persons={fleet.persons}
              loading={fleet.loading}
              onOpenDevice={openDevice}
            />
          ) : page === 'persons' ? (
            <PersonsPage
              persons={fleet.persons}
              devices={fleet.devices}
              isAdmin={isAdmin}
              onOpenDevice={openDevice}
              onRefresh={fleet.refresh}
            />
          ) : page === 'alerts' ? (
            <AlertsPage
              alerts={fleet.alerts}
              devices={fleet.devices}
              onOpenDevice={openDevice}
              onRefresh={fleet.refresh}
            />
          ) : page === 'patches' ? (
            <PatchesPage
              devices={fleet.devices}
              patchSummary={fleet.patchSummary}
              persons={fleet.persons}
              onOpenDevice={openDevice}
            />
          ) : page === 'scripts' ? (
            <ScriptsPage canManage={isOperator} devices={fleet.devices} onOpenDevice={openDevice} />
          ) : page === 'automation' ? (
            <AutomationPage devices={fleet.devices} persons={fleet.persons} isAdmin={isAdmin} />
          ) : page === 'docs' ? (
            <DocsPage />
          ) : page === 'admin' ? (
            <AdminPage currentUser={user} />
          ) : (
            <AuditPage />
          )}
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          devices={fleet.devices}
          isAdmin={isAdmin}
          canEnroll={isOperator}
          onClose={() => setPaletteOpen(false)}
          onNavigate={goPage}
          onOpenDevice={openDevice}
          onOpenEnroll={() => {
            setPaletteOpen(false);
            setEnrollOpen(true);
          }}
          onToggleTheme={toggleTheme}
        />
      )}
      {enrollOpen && (
        <EnrollModal
          onClose={() => {
            setEnrollOpen(false);
            fleet.refresh();
          }}
        />
      )}
    </div>
  );
}
