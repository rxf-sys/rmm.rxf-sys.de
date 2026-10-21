/**
 * CSV for German spreadsheets: semicolon-separated with a byte-order mark and
 * CRLF line ends — what Excel in a German locale opens correctly by
 * double-click, and what every other tool imports.
 */

/** Spreadsheets run a cell that starts with one of these as a formula. The
 *  data comes from agents and users, so it is never trusted not to be one. */
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | null;

export function csvCell(v: CsvValue): string {
  if (v === null) return '';
  let s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvDocument(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

/** Hand a CSV to the browser as a download. */
export function downloadCsv(csv: string, name: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next task: some browsers start the download only after
  // the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
