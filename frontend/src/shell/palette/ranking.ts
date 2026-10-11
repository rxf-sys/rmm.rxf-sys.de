/**
 * Search ranking for the command palette.
 *
 * Every candidate is a list of text fields with a weight. A query term scores
 * by how it meets a field — exact, prefix, word start, anywhere — and the tier
 * always wins over the field: an exact tag beats a hostname that merely starts
 * with the term. The weight only breaks ties inside a tier, so with equal
 * matches the hostname ranks above a tag, a tag above the owner.
 */

import { osLabel } from '../../format';
import type { Device } from '../../types';

/** 0 = no match, then substring < word start < prefix < exact. */
export type Tier = 0 | 1 | 2 | 3 | 4;

/** More rows than this do not help anyone pick: the query needs a word more. */
export const MAX_DEVICE_ROWS = 50;

/**
 * Lower case without diacritics, so "gerat" finds „Gerät“ and a hostname
 * typed without the umlaut still matches. ß becomes ss for the same reason.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss');
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** How `term` occurs in `text`; both already normalized. */
export function matchTier(text: string, term: string): Tier {
  if (!term || !text) return 0;
  if (text === term) return 4;
  if (text.startsWith(term)) return 3;
  let at = text.indexOf(term);
  if (at < 0) return 0;
  // "pc" in "buero-pc" starts a word; "ero" in "buero" does not. Every
  // occurrence counts, so "lab-alabama" still finds the word start.
  while (at > 0) {
    if (!WORD_CHAR.test(text.charAt(at - 1))) return 2;
    at = text.indexOf(term, at + 1);
  }
  return 1;
}

export interface Field {
  /** Normalized text. */
  text: string;
  /** Tie-breaker inside a tier, 0–9. */
  weight: number;
}

/** Score of one term against a set of fields: tier × 10 + weight, 0 = none. */
export function termScore(fields: readonly Field[], term: string): number {
  let best = 0;
  for (const f of fields) {
    const tier = matchTier(f.text, term);
    if (tier > 0) best = Math.max(best, tier * 10 + f.weight);
  }
  return best;
}

/**
 * Score of a whole query. The query as typed comes first; a query of several
 * words also matches when every word matches somewhere — „lisa iphone“ finds
 * „iPhone von Lisa“ — and then counts as its weakest word.
 */
export function scoreQuery(query: string, score: (term: string) => number): number {
  const q = normalize(query).trim();
  if (!q) return 0;
  const whole = score(q);
  const terms = q.split(/\s+/);
  if (terms.length < 2) return whole;
  let weakest = Infinity;
  for (const t of terms) {
    const s = score(t);
    if (s === 0) return whole;
    weakest = Math.min(weakest, s);
  }
  return Math.max(whole, weakest);
}

/** A device prepared for searching: normalized once per fleet update, not
 *  once per keystroke. */
export interface DeviceEntry {
  device: Device;
  /** The hostname occurs more than once in the fleet; show the id with it. */
  showId: boolean;
  fields: Field[];
  /** `#<id>`, matched only by a term that starts with "#" — a bare "3"
   *  would otherwise find every device whose id contains a three. */
  idText: string;
}

const W_HOST = 4;
const W_TAG = 3;
const W_OWNER = 2;
const W_OS = 1;

/** Hostnames that occur more than once, lower case. Hostnames are case
 *  insensitive, so "NAS" and "nas" are the same name to a person reading. */
export function duplicateHostnames(devices: readonly Device[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const d of devices) {
    const h = d.hostname.toLowerCase();
    if (seen.has(h)) dup.add(h);
    else seen.add(h);
  }
  return dup;
}

export function indexDevices(devices: readonly Device[]): DeviceEntry[] {
  const dup = duplicateHostnames(devices);
  return devices.map((device) => ({
    device,
    showId: dup.has(device.hostname.toLowerCase()),
    fields: [
      { text: normalize(device.hostname), weight: W_HOST },
      ...device.tags.map((t) => ({ text: normalize(t), weight: W_TAG })),
      { text: normalize(device.owner_label), weight: W_OWNER },
      { text: normalize(osLabel(device.os)), weight: W_OS },
    ],
    idText: `#${device.id}`,
  }));
}

export interface DeviceHit {
  entry: DeviceEntry;
  score: number;
  /** The tag that matched when the hostname did not — it explains the row. */
  tag: string | null;
}

function entryScore(e: DeviceEntry, term: string): number {
  const byId = term.startsWith('#') ? matchTier(e.idText, term) : 0;
  return Math.max(termScore(e.fields, term), byId > 0 ? byId * 10 + W_HOST : 0);
}

/** The tag to show beside a hit, if the hostname alone does not explain it. */
function explainingTag(e: DeviceEntry, query: string): string | null {
  const host = e.fields[0];
  if (!host || scoreQuery(query, (t) => matchTier(host.text, t)) > 0) return null;
  let best: { tag: string; score: number } | null = null;
  for (const tag of e.device.tags) {
    const s = scoreQuery(query, (t) => matchTier(normalize(tag), t));
    if (s > 0 && (!best || s > best.score)) best = { tag, score: s };
  }
  return best?.tag ?? null;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Matching devices, best first, at most `limit`; `total` counts them all. */
export function rankDevices(
  index: readonly DeviceEntry[],
  query: string,
  limit = MAX_DEVICE_ROWS,
): { hits: DeviceHit[]; total: number } {
  const scored: { entry: DeviceEntry; score: number }[] = [];
  for (const entry of index) {
    const score = scoreQuery(query, (t) => entryScore(entry, t));
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      collator.compare(a.entry.device.hostname, b.entry.device.hostname) ||
      a.entry.device.id - b.entry.device.id,
  );
  // The explaining tag is only worked out for the rows that are shown.
  const hits = scored.slice(0, limit).map((s) => ({ ...s, tag: explainingTag(s.entry, query) }));
  return { hits, total: scored.length };
}
