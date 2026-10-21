import type { NtfyConfig } from '../../types';
import type { StatusKind } from '../../ui';

/** The server's default topic (NTFY_TOPIC in docs/CONFIGURATION.md). */
export const DEFAULT_TOPIC = 'rxf-rmm';

/** Where the effective settings come from, as the panel's status. */
export const NTFY_SOURCE: Record<NtfyConfig['source'], { kind: StatusKind; label: string }> = {
  ui: { kind: 'ok', label: 'eingerichtet' },
  env: { kind: 'ok', label: 'aus der Serverkonfiguration' },
  none: { kind: 'neutral', label: 'aus' },
};

export interface NtfyDraft {
  base: string;
  topic: string;
  /** A new token; empty keeps whatever is stored. */
  token: string;
  /** Remove the stored token instead. */
  dropToken: boolean;
}

export const draftFrom = (cfg: NtfyConfig): NtfyDraft => ({
  base: cfg.base,
  topic: cfg.topic || DEFAULT_TOPIC,
  token: '',
  dropToken: false,
});

/** The PUT body. The server reads the token three ways: null keeps the
 *  stored one, "" removes it, anything else replaces it. */
export function ntfyBody(d: NtfyDraft): { base: string; topic: string; token: string | null } {
  return {
    base: d.base.trim(),
    topic: d.topic.trim() || DEFAULT_TOPIC,
    token: d.dropToken ? '' : d.token ? d.token : null,
  };
}

export function ntfyDirty(cfg: NtfyConfig, d: NtfyDraft): boolean {
  const b = ntfyBody(d);
  return b.base !== cfg.base || b.topic !== (cfg.topic || DEFAULT_TOPIC) || b.token !== null;
}

/** Only an http(s) address can be posted to; empty is allowed and means off. */
export function baseProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\/[^\s/]+/i.test(v)) return 'Bitte mit http:// oder https:// beginnen, etwa https://ntfy.sh.';
  return null;
}

/**
 * Settings from .env are only read, never copied: the first save from the
 * dashboard stores its own set, and an env token does not come along. Said
 * next to the token field, so nobody loses it unnoticed.
 */
export function tokenHint(cfg: NtfyConfig, d: NtfyDraft): string {
  if (d.dropToken) return 'Der gespeicherte Token wird beim Speichern entfernt.';
  if (cfg.source === 'env' && cfg.has_token)
    return 'Der Token aus der Serverkonfiguration wird beim Speichern nicht übernommen — verlangt der Server einen, bitte hier eintragen.';
  if (cfg.has_token) return 'Ein Token ist gespeichert. Leer lassen, um ihn zu behalten.';
  return 'Nur nötig, wenn der ntfy-Server einen verlangt.';
}
