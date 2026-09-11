/**
 * Alarmregeln in Worten.
 *
 * Zwei Seiten reden über dieselben Regeln — die Automatisierung, wo sie
 * eingestellt werden, und das Alarm-Center, wo man sieht, was sie ausgelöst
 * haben. Vorher stand dort „Gerät offline · 300 Sekunden" und hier gar
 * nichts; beides steht jetzt hier, damit die Formulierung an einer Stelle
 * gepflegt wird und nicht auseinanderläuft.
 */

import type { AlertRule, Device, Person, RuleType } from './types';

export const RULE_META: Record<RuleType, { label: string; unit: string; defaultHint: string }> = {
  offline: { label: 'Gerät offline', unit: 'Sekunden', defaultHint: 'Standard: 300 s' },
  disk: { label: 'Disk-Belegung', unit: '%', defaultHint: 'Standard: 90 %' },
  patch_age: {
    label: 'Überfällige Sicherheitsupdates',
    unit: 'Tage',
    defaultHint: 'Standard: 30 Tage',
  },
};

/** Serverseitige Vorgaben, wenn eine Regel keinen eigenen Schwellwert hat
 *  (OFFLINE_ALERT_AFTER_S, DISK_ALERT_PCT, PATCH_ALERT_AGE_DAYS). */
const RULE_DEFAULT: Record<RuleType, number> = { offline: 300, disk: 90, patch_age: 30 };

/** Sekunden in eine Angabe, die ein Mensch vorliest. */
export function humanSeconds(s: number): string {
  if (s % 86400 === 0 && s >= 86400) return `${s / 86400} Tag${s / 86400 === 1 ? '' : 'e'}`;
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600} Stunde${s / 3600 === 1 ? '' : 'n'}`;
  if (s % 60 === 0 && s >= 60) return `${s / 60} Minute${s / 60 === 1 ? '' : 'n'}`;
  return `${s} Sekunde${s === 1 ? '' : 'n'}`;
}

/** Wie lange ein Zustand schon anhält, kurz genug für eine Tabellenspalte. */
export function sinceLabel(from: number, now: number): string {
  const s = Math.max(0, now - from);
  if (s < 90) return 'gerade eben';
  if (s < 5400) return `seit ${Math.round(s / 60)} Min.`;
  if (s < 36 * 3600) return `seit ${Math.round(s / 3600)} Std.`;
  return `seit ${Math.round(s / 86400)} Tagen`;
}

/** Der Satz, der die Regel beschreibt. Ohne Schwellwert gilt die Vorgabe des
 *  Servers — das steht dann auch dabei, statt eine Zahl zu erfinden. */
export function ruleSentence(type: RuleType, threshold: number | null): string {
  const value = threshold ?? RULE_DEFAULT[type];
  const suffix = threshold === null ? ' (Standard)' : '';
  switch (type) {
    case 'offline':
      return `Meldet sich ein Gerät länger als ${humanSeconds(value)}${suffix} nicht, löst das einen Alarm aus.`;
    case 'disk':
      return `Überschreitet eine Platte ${value} %${suffix}, löst das einen Alarm aus.`;
    case 'patch_age':
      return `Ist ein Sicherheitsupdate länger als ${value} Tage${suffix} offen, löst das einen Alarm aus.`;
  }
}

/** Kurzform für Zeilen, in denen kein ganzer Satz Platz hat. */
export function ruleShort(type: RuleType, threshold: number | null): string {
  const value = threshold ?? RULE_DEFAULT[type];
  switch (type) {
    case 'offline':
      return `Gerät offline ab ${humanSeconds(value)}`;
    case 'disk':
      return `Disk-Belegung ab ${value} %`;
    case 'patch_age':
      return `Sicherheitsupdates ab ${value} Tagen`;
  }
}

export function scopeLabel(rule: AlertRule, persons: Person[]): string {
  if (rule.scope_kind === 'tag') return `Tag: ${rule.scope_value}`;
  if (rule.scope_kind === 'person') {
    const p = persons.find((x) => String(x.id) === rule.scope_value);
    return p ? `Person: ${p.name}` : `Person #${rule.scope_value}`;
  }
  return 'alle Geräte';
}

export function affectedDevices(rule: AlertRule, devices: Device[]): Device[] {
  if (rule.scope_kind === 'tag') return devices.filter((d) => d.tags.includes(rule.scope_value));
  if (rule.scope_kind === 'person')
    return devices.filter((d) => String(d.person_id ?? '') === rule.scope_value);
  return devices;
}

const SPECIFICITY: Record<string, number> = { all: 1, tag: 2, person: 3 };

/**
 * Welche Regel dieses Typs gilt für dieses Gerät?
 *
 * Spiegelt `effective_rule()` in backend/app/automation.py: die
 * spezifischste Zuweisung gewinnt, Person vor Tag vor „alle". Hier nur, um
 * einen ausgelösten Alarm seiner Regel zuzuordnen — entschieden wird das
 * weiterhin auf dem Server.
 */
export function effectiveRule(
  rules: AlertRule[],
  device: Device | undefined,
  type: RuleType,
): AlertRule | undefined {
  if (!device) return undefined;
  const candidates = rules.filter(
    (r) => r.type === type && affectedDevices(r, [device]).length === 1,
  );
  return candidates.sort(
    (a, b) => (SPECIFICITY[b.scope_kind] ?? 0) - (SPECIFICITY[a.scope_kind] ?? 0),
  )[0];
}
