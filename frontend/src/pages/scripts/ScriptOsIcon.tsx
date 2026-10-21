import { IconGrid, OsIcon } from '../../icons';
import type { ScriptOs } from '../../types';

/** The system a script is for; "any" gets its own mark instead of a logo. */
export function ScriptOsIcon({ os, size = 14 }: { os: ScriptOs; size?: number }) {
  return os === 'any' ? <IconGrid size={size} /> : <OsIcon os={os} size={size} />;
}
