import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CommandPalette } from './shell/palette/CommandPalette';
import { ConnectionBanner } from './components/ConnectionBanner';
import { DevicesPage } from './pages/devices/DevicesPage';
import { BootSequence, type BootSummary } from './boot/BootSequence';
import { EnrollModal } from './shell/enroll/EnrollModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/login/LoginPage';
import { OverviewPage } from './pages/overview/OverviewPage';
import { isAgent } from './deviceClass';
import { deviceStatusKind } from './deviceStatus';
import type { Device } from './types';
import type { PatchSummary } from './types';
import { Skeleton } from './ui';
import { IconInfo, IconStatusDanger, IconStatusOk, IconStatusWarn } from './icons';
import { BottomNav } from './shell/BottomNav';
import { MoreSheet } from './shell/MoreSheet';
import { Rail } from './shell/Rail';
import { goShortcutsFor } from './shell/nav';
import type { QuickTab } from './shell/palette/paletteModel';
import { ShortcutsDialog } from './shell/ShortcutsDialog';
import { Topbar, type Crumb } from './shell/Topbar';
import { setToastNavigator } from './ui/toast';
import { useShortcuts } from './hooks/useShortcuts';
import { useAuth } from './hooks/useAuth';
import { useFleet } from './hooks/useFleet';
import { useTheme } from './hooks/useTheme';
import { PAGE_LABEL, PAGE_PATH, devicePath, pageForPath, type PageId } from './routes';

// Übersicht und Geräteliste tragen das erste Bild und bleiben im Hauptbündel.
// Alles andere wird beim ersten Aufruf nachgeladen: die Detailseite, die
// Doku und die Administration machten zusammen den größten Teil eines
// Bündels aus, das jeder Login vollständig herunterlud.
const AlertsPage = lazy(() => import('./pages/alerts/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const AuditPage = lazy(() => import('./pages/audit/AuditPage').then((m) => ({ default: m.AuditPage })));
const AutomationPage = lazy(() => import('./pages/automation/AutomationPage').then((m) => ({ default: m.AutomationPage })));
const DevicePage = lazy(() => import('./pages/device/DevicePage').then((m) => ({ default: m.DevicePage })));
const DocsPage = lazy(() => import('./pages/docs/DocsPage').then((m) => ({ default: m.DocsPage })));
const PatchesPage = lazy(() => import('./pages/patches/PatchesPage').then((m) => ({ default: m.PatchesPage })));
const PersonsPage = lazy(() => import('./pages/persons/PersonsPage').then((m) => ({ default: m.PersonsPage })));
const ScriptsPage = lazy(() => import('./pages/scripts/ScriptsPage').then((m) => ({ default: m.ScriptsPage })));

const FAV_KEY = 'vulpexa-favorites';
// Das Produkt hieß einmal anders; wer Favoriten hat, soll sie behalten.
const LEGACY_FAV_KEY = 'ryntra-favorites';

function loadFavorites(): number[] {
  try {
    const stored = localStorage.getItem(FAV_KEY) ?? localStorage.getItem(LEGACY_FAV_KEY);
    const raw: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [];
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
  patchSummary,
  onToggleFavorite,
  onDeleted,
}: {
  isAdmin: boolean;
  isOperator: boolean;
  favorites: number[];
  patchSummary: PatchSummary;
  onToggleFavorite: (id: number) => void;
  onDeleted: () => void;
}) {
  const { deviceId } = useParams();
  const id = Number(deviceId);
  if (!Number.isInteger(id) || id <= 0) return <Navigate to={PAGE_PATH.devices} replace />;
  return (
    <DevicePage
      deviceId={id}
      patchCounts={patchSummary[String(id)]}
      isAdmin={isAdmin}
      isOperator={isOperator}
      favorite={favorites.includes(id)}
      onToggleFavorite={() => onToggleFavorite(id)}
      onDeleted={onDeleted}
    />
  );
}

/** What the boot sequence reports when it hands over. */
function bootSummary(devices: Device[]): BootSummary {
  const mix = { ok: 0, warn: 0, danger: 0, off: 0 };
  let online = 0;
  for (const d of devices) {
    const k = deviceStatusKind(d);
    if (k === 'noagent' || k === 'mdm') continue;
    mix[k] += 1;
    if (d.online) online += 1;
  }
  return { devices: devices.length, online, attention: mix.warn + mix.danger + mix.off, mix };
}

export default function App() {
  const { user, status, login, logout } = useAuth();
  const { preference: themePref, resolved: theme, setPreference: setTheme, toggle: toggleTheme } = useTheme();
  const fleet = useFleet(user !== null);
  // Seiten, die von Agent-Telemetrie leben (Updates, Skripte, Alarmregeln),
  // bekommen nur die Geräte mit Agent: ein Telefon dort zu listen hieße, eine
  // Zeile anzubieten, auf der nichts passieren kann.
  const agentDevices = useMemo(() => fleet.devices.filter(isAgent), [fleet.devices]);
  // Phones under MDM: the patch page shows their iOS state, the phone alarm
  // rules count them.
  const mdmPhones = useMemo(
    () => fleet.devices.filter((d) => !isAgent(d) && d.mdm != null && d.mdm.checked_out_at === null),
    [fleet.devices],
  );
  const navigate = useNavigate();
  const location = useLocation();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Overlays belong to the session that opened them. App stays mounted across
  // sign-out and only swaps in the login page, so an open "Gerät hinzufügen"
  // or navigation sheet used to come back for whoever signed in next, a
  // viewer included. Reset while rendering, so not even one frame shows them.
  const sessionId = user?.id ?? null;
  const [overlaySession, setOverlaySession] = useState(sessionId);
  if (overlaySession !== sessionId) {
    setOverlaySession(sessionId);
    setPaletteOpen(false);
    setEnrollOpen(false);
    setMoreOpen(false);
    setHelpOpen(false);
  }
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);

  const toggleFavorite = useCallback((id: number) => {
    setFavorites((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        // Speicher blockiert oder voll: der Favorit gilt für diese Sitzung.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setToastNavigator((path) => navigate(path));
    return () => setToastNavigator(null);
  }, [navigate]);

  const role = user?.role ?? null;
  const goShortcuts = useMemo(() => (role ? goShortcutsFor(role) : []), [role]);
  const openPalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const goPath = useCallback((path: string) => navigate(path), [navigate]);
  useShortcuts({ enabled: user !== null, go: goShortcuts, onNavigate: goPath, onPalette: openPalette, onHelp: openHelp });

  // Startup sequence: plays until auth and (when signed in) the first fleet
  // load are done, then hands over to the shell.
  const [booted, setBooted] = useState(false);
  const finishBoot = useCallback(() => setBooted(true), []);
  const bootReady = status !== 'loading' && (status === 'anon' || !fleet.loading);
  const summary = useMemo(() => bootSummary(fleet.devices), [fleet.devices]);

  // The tab title names the page (and the device on device pages).
  const titleDeviceId = /^\/devices\/(\d+)/.exec(location.pathname)?.[1];
  const titleDevice = titleDeviceId ? fleet.devices.find((d) => d.id === Number(titleDeviceId))?.hostname : undefined;
  const pageTitle = titleDeviceId ? (titleDevice ?? 'Gerät') : PAGE_LABEL[pageForPath(location.pathname)];
  useEffect(() => {
    document.title = `${pageTitle} · Vulpexa`;
  }, [pageTitle]);

  // A new page moves focus to the content, so a screen reader starts reading
  // there instead of at the top of the shell. Not on the very first render.
  const mainRef = useRef<HTMLElement>(null);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const boot = booted ? null : (
    <BootSequence
      ready={bootReady}
      signedIn={status === 'loading' ? null : status === 'authed'}
      summary={summary}
      error={fleet.error}
      onDone={finishBoot}
    />
  );
  if (status === 'loading') return boot;
  if (status === 'anon' || !user)
    return (
      <>
        <LoginPage onLogin={login} />
        {boot}
      </>
    );

  const isAdmin = user.role === 'admin';
  // Techniker: hands-on device work (jobs, scripts, patches, remote, enrollment).
  const isOperator = isAdmin || user.role === 'techniker';

  // Navigation closes the transient overlays: leaving the palette or the mobile
  // drawer hanging over the new page is the one thing they must never do.
  const closeOverlays = () => {
    setPaletteOpen(false);
    setMoreOpen(false);
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
  const openDeviceTab = (id: number, tab?: QuickTab) => {
    closeOverlays();
    navigate(tab ? `${devicePath(id)}?tab=${tab}` : devicePath(id));
  };

  const page = pageForPath(location.pathname);
  // "Open" means what the Alarm-Center's first tab shows: not resolved and
  // not acknowledged yet. Acknowledged alerts are someone's already.
  const openAlerts = fleet.alerts.filter((a) => a.resolved_at === null && a.acked_at === null).length;
  const openPatches = Object.values(fleet.patchSummary).reduce((a, s) => a + s.pending, 0);

  const detailMatch = /^\/devices\/(\d+)/.exec(location.pathname);
  const detailIdRaw = detailMatch?.[1];
  const detailId = detailIdRaw ? Number(detailIdRaw) : null;
  const detailDevice = detailId !== null ? fleet.devices.find((d) => d.id === detailId) : undefined;
  const crumbs: Crumb[] =
    detailId !== null
      ? [
          { label: PAGE_LABEL.devices, to: PAGE_PATH.devices },
          { label: detailDevice?.hostname ?? `Gerät ${detailId}` },
        ]
      : [{ label: PAGE_LABEL[page] }];

  return (
    <>
    <div className="shell">
      <a className="skip-link" href="#main">
        Zum Inhalt springen
      </a>
      <Rail
        user={user}
        devices={fleet.devices}
        favorites={favorites}
        openAlerts={openAlerts}
        openPatches={openPatches}
        theme={themePref}
        onTheme={setTheme}
        onShortcuts={openHelp}
        onLogout={() => void logout()}
      />
      <div className="shell-main">
        <Topbar
          crumbs={crumbs}
          alerts={fleet.alerts}
          devices={fleet.devices}
          canEnroll={isOperator}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenEnroll={() => setEnrollOpen(true)}
        />
        <main id="main" ref={mainRef} className="shell-content" tabIndex={-1}>
          <ConnectionBanner error={fleet.error} loadedAt={fleet.loadedAt} onRetry={fleet.refresh} />
          {/* Ein Skelett statt eines leeren Rahmens, solange ein Seitenbündel
              unterwegs ist — im LAN ist das ein Wimpernschlag, über eine
              schlechte Leitung nicht. */}
          <ErrorBoundary key={location.pathname} variant="page">
          <Suspense fallback={<div className="screen"><Skeleton h={160} /></div>}>
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
                  loadError={fleet.loadErrors.devices}
                  onRetry={fleet.refresh}
                  canOperate={isOperator}
                  onOpenEnroll={isOperator ? () => setEnrollOpen(true) : undefined}
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
                  patchSummary={fleet.patchSummary}
                  onToggleFavorite={toggleFavorite}
                  onDeleted={() => {
                    navigate(PAGE_PATH.devices);
                    fleet.refresh();
                  }}
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
                  persons={fleet.persons}
                  alerts={fleet.alerts}
                  resolvedCap={fleet.resolvedAlertsCap}
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
                  onRefresh={fleet.refresh}
                  isOperator={isOperator}
                  devices={agentDevices}
                  phones={mdmPhones}
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
                  <ScriptsPage canManage={isOperator} devices={agentDevices} />
                ) : (
                  <Forbidden />
                )
              }
            />
            <Route
              path={PAGE_PATH.automation}
              element={
                <AutomationPage devices={agentDevices} phones={mdmPhones} persons={fleet.persons} isAdmin={isAdmin} />
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
          </Suspense>
          </ErrorBoundary>
        </main>
        <BottomNav openAlerts={openAlerts} moreOpen={moreOpen} onMore={() => setMoreOpen((o) => !o)} />
      </div>

      {paletteOpen && (
        <CommandPalette
          devices={fleet.devices}
          isAdmin={isAdmin}
          canEnroll={isOperator}
          onClose={() => setPaletteOpen(false)}
          onNavigate={goPage}
          onOpenDevice={openDeviceTab}
          onOpenEnroll={() => {
            setPaletteOpen(false);
            setEnrollOpen(true);
          }}
          onToggleTheme={toggleTheme}
        />
      )}
      {moreOpen && (
        <MoreSheet
          user={user}
          theme={themePref}
          onTheme={setTheme}
          onLogout={() => void logout()}
          onClose={() => setMoreOpen(false)}
          onOpenEnroll={isOperator ? () => setEnrollOpen(true) : undefined}
        />
      )}
      {helpOpen && <ShortcutsDialog go={goShortcuts} onClose={() => setHelpOpen(false)} />}
      {/* Only for roles that may enroll: the server refuses everyone else. */}
      {enrollOpen && isOperator && (
        <EnrollModal
          onClose={() => {
            setEnrollOpen(false);
            fleet.refresh();
          }}
          onDeviceCreated={() => fleet.refresh()}
          isAdmin={isAdmin}
        />
      )}
      <Toaster
        theme={theme}
        position="bottom-right"
        containerAriaLabel="Benachrichtigungen"
        closeButton
        visibleToasts={4}
        mobileOffset={{ bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))', left: '12px', right: '12px' }}
        icons={{
          success: <IconStatusOk size={16} />,
          error: <IconStatusDanger size={16} />,
          warning: <IconStatusWarn size={16} />,
          info: <IconInfo size={16} />,
        }}
      />
    </div>
    {boot}
    </>
  );
}
