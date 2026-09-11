import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { PAGE_LABEL, PAGE_PATH, devicePath, pageForPath } from './routes';

const FAV_KEY = 'ryntra-favorites';

function loadFavorites(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** A page the current role may not open. The API refuses it anyway; this makes
 *  a hand-typed or bookmarked URL say so instead of rendering a broken page. */
function Forbidden() {
  return (
    <div className="empty">
      <h2>Kein Zugriff</h2>
      <p className="muted">Diese Seite ist für deine Rolle nicht freigegeben.</p>
    </div>
  );
}

/** Route element for a device page — the id comes from the URL.
 *  Defined at module scope: a component created inside App would be a new
 *  type on every render, remounting the device page and losing its tab. */
function DeviceRoute({
  isAdmin,
  isOperator,
  favorites,
  onToggleFavorite,
  onLeave,
  onDeleted,
  onLogout,
}: {
  isAdmin: boolean;
  isOperator: boolean;
  favorites: number[];
  onToggleFavorite: (id: number) => void;
  onLeave: () => void;
  onDeleted: () => void;
  onLogout: () => Promise<void> | void;
}) {
  const { deviceId } = useParams();
  const id = Number(deviceId);
  if (!Number.isInteger(id) || id <= 0) return <Navigate to={PAGE_PATH.devices} replace />;
  return (
    <DeviceDetail
      deviceId={id}
      isAdmin={isAdmin}
      isOperator={isOperator}
      favorite={favorites.includes(id)}
      onToggleFavorite={() => onToggleFavorite(id)}
      onBack={onLeave}
      onDeleted={onDeleted}
      onLogout={onLogout}
    />
  );
}

export default function App() {
  const { user, status, login, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const fleet = useFleet();
  const navigate = useNavigate();
  const location = useLocation();

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
  }, [userId, refresh]);

  // ⌘K / Ctrl+K toggles the palette. Escape is handled inside the dialogs
  // themselves (components/Modal.tsx), so it is not intercepted here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
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

  // Navigation closes the transient overlays: leaving the palette or the mobile
  // drawer hanging over the new page is the one thing they must never do.
  const closeOverlays = () => {
    setPaletteOpen(false);
    setNavOpen(false);
  };
  // `query` trägt Filter mit (z. B. die Übersicht, die auf die Geräteseite mit
  // genau einem Filter verweist) — der Pfad bleibt die Wahrheit über die Seite.
  const goPage = (p: PageId, query?: string) => {
    closeOverlays();
    navigate(query ? `${PAGE_PATH[p]}?${query}` : PAGE_PATH[p]);
  };
  const openDevice = (id: number) => {
    closeOverlays();
    navigate(devicePath(id));
  };

  const page = pageForPath(location.pathname);
  const openAlerts = fleet.alerts.filter((a) => a.resolved_at === null).length;
  const openPatches = Object.values(fleet.patchSummary).reduce((a, s) => a + s.pending, 0);

  const detailMatch = /^\/devices\/(\d+)/.exec(location.pathname);
  const detailIdRaw = detailMatch?.[1];
  const detailId = detailIdRaw ? Number(detailIdRaw) : null;
  const detailDevice = detailId !== null ? fleet.devices.find((d) => d.id === detailId) : undefined;
  const crumbCur =
    detailId !== null ? (detailDevice?.hostname ?? `Gerät ${detailId}`) : PAGE_LABEL[page];
  const crumbPre = detailId !== null ? 'Vulpexa / Geräte / ' : 'Vulpexa / ';

  return (
    <div className={navOpen ? 'app-shell nav-open' : 'app-shell'}>
      {navOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Navigation schließen"
          onClick={() => setNavOpen(false)}
        />
      )}
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
          <Routes>
            <Route
              path={PAGE_PATH.overview}
              element={
                <OverviewPage
                  fleet={fleet}
                  user={user}
                  onOpenDevice={openDevice}
                  onNavigate={goPage}
                  onOpenEnroll={() => setEnrollOpen(true)}
                  canEnroll={isOperator}
                />
              }
            />
            <Route
              path={PAGE_PATH.devices}
              element={
                <DevicesPage
                  devices={fleet.devices}
                  patchSummary={fleet.patchSummary}
                  persons={fleet.persons}
                  loading={fleet.loading}
                  onOpenDevice={openDevice}
                />
              }
            />
            <Route
              path={`${PAGE_PATH.devices}/:deviceId`}
              element={
                <DeviceRoute
                  isAdmin={isAdmin}
                  isOperator={isOperator}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  onLeave={() => navigate(PAGE_PATH.devices)}
                  onDeleted={() => {
                    navigate(PAGE_PATH.devices);
                    fleet.refresh();
                  }}
                  onLogout={logout}
                />
              }
            />
            <Route
              path={PAGE_PATH.persons}
              element={
                <PersonsPage
                  persons={fleet.persons}
                  devices={fleet.devices}
                  alerts={fleet.alerts}
                  patchSummary={fleet.patchSummary}
                  isAdmin={isAdmin}
                  onOpenDevice={openDevice}
                  onRefresh={fleet.refresh}
                />
              }
            />
            <Route
              path={PAGE_PATH.alerts}
              element={
                <AlertsPage
                  alerts={fleet.alerts}
                  devices={fleet.devices}
                  onOpenDevice={openDevice}
                  onRefresh={fleet.refresh}
                />
              }
            />
            <Route
              path={PAGE_PATH.patches}
              element={
                <PatchesPage
                  devices={fleet.devices}
                  patchSummary={fleet.patchSummary}
                  persons={fleet.persons}
                  onOpenDevice={openDevice}
                />
              }
            />
            <Route
              path={PAGE_PATH.scripts}
              element={
                isOperator ? (
                  <ScriptsPage
                    canManage={isOperator}
                    devices={fleet.devices}
                    onOpenDevice={openDevice}
                  />
                ) : (
                  <Forbidden />
                )
              }
            />
            <Route
              path={PAGE_PATH.automation}
              element={
                <AutomationPage devices={fleet.devices} persons={fleet.persons} isAdmin={isAdmin} />
              }
            />
            <Route path={PAGE_PATH.docs} element={<DocsPage />} />
            <Route path={PAGE_PATH.audit} element={isAdmin ? <AuditPage devices={fleet.devices} /> : <Forbidden />} />
            <Route
              path={PAGE_PATH.admin}
              element={isAdmin ? <AdminPage currentUser={user} /> : <Forbidden />}
            />
            {/* An unknown path is a typo or a stale bookmark, not something
                that deserves a page of its own. */}
            <Route path="*" element={<Navigate to={PAGE_PATH.overview} replace />} />
          </Routes>
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
