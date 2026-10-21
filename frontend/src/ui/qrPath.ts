import { create } from 'qrcode';

/** Quiet zone around the code in modules; the spec asks for four. */
const QUIET = 4;

/** SVG path of the dark modules, one unit square each, plus the side length
 *  of the whole symbol including the quiet zone. */
export function qrPath(text: string): { size: number; d: string } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) parts.push(`M${col + QUIET} ${row + QUIET}h1v1h-1z`);
    }
  }
  return { size: modules.size + 2 * QUIET, d: parts.join('') };
}
