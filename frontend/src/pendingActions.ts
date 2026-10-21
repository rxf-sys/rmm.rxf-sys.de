/**
 * Actions queued for a device's next time online, as the dashboard words
 * them. The server decides what runs when (backend/app/action_runner.py);
 * this only says it.
 */
import type { PendingAction, PendingActionState } from './types';
import type { StatusKind } from './ui';

export const ACTION_STATE: Record<PendingActionState, { label: string; kind: StatusKind }> = {
  pending: { label: 'Wartet auf das Gerät', kind: 'info' },
  dispatched: { label: 'Läuft', kind: 'info' },
  done: { label: 'Erledigt', kind: 'ok' },
  failed: { label: 'Fehlgeschlagen', kind: 'danger' },
  expired: { label: 'Abgelaufen', kind: 'off' },
  cancelled: { label: 'Zurückgezogen', kind: 'neutral' },
};

export function isOpen(a: Pick<PendingAction, 'state'>): boolean {
  return a.state === 'pending' || a.state === 'dispatched';
}

/** What the action does, in one line. `scriptName` resolves a script id. */
export function actionTitle(a: PendingAction, scriptName: (id: number) => string | undefined): string {
  if (a.kind === 'patch_install') {
    const what = a.security_only ? 'Sicherheitsupdates installieren' : 'Alle Updates installieren';
    return a.reboot ? `${what}, danach Neustart falls nötig` : what;
  }
  if (a.kind === 'reboot') return 'Neustart, falls das System ihn verlangt';
  const name = a.script_id !== null ? scriptName(a.script_id) : undefined;
  return name ? `Skript „${name}“ ausführen` : 'Skript ausführen';
}

/** Who asked for it. */
export function actionOrigin(a: Pick<PendingAction, 'source' | 'created_by'>): string {
  if (a.source === 'patch_window') return 'Patch-Fenster, nachgeholt';
  if (a.source === 'follow_up') return 'nach der Installation';
  return a.created_by || 'Automatisierung';
}

/** Lifetimes offered when queuing, in hours. */
export const TTL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 Tag' },
  { hours: 72, label: '3 Tage' },
  { hours: 7 * 24, label: '1 Woche' },
  { hours: 14 * 24, label: '2 Wochen' },
  { hours: 30 * 24, label: '30 Tage' },
];
export const DEFAULT_TTL_HOURS = 14 * 24;
