/**
 * Devices recently opened from the palette, newest first.
 *
 * Kept per browser: it is a personal shortcut, like the saved device views.
 * Only ids are stored — names and status come from the live fleet, so a
 * renamed device shows its new name and a deleted one simply drops out.
 */

export const RECENT_KEY = 'vulpexa-palette-recent';
export const MAX_RECENT = 5;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Stored ids, validated: anything hand-edited or from an older format is
 *  dropped rather than trusted. */
export function loadRecent(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isId))].slice(0, MAX_RECENT);
  } catch {
    // Blocked storage or broken JSON: no history is a fine answer.
    return [];
  }
}

/** Moves `id` to the front and stores the list; returns it either way. */
export function rememberDevice(id: number): number[] {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the device still opens.
  }
  return next;
}
