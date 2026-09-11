/** Zeitrechnung für die Automatisierung: wann läuft etwas das nächste Mal? */

/**
 * Nächster Termin für „jeden <weekday> um <hour> Uhr", in Sekunden seit
 * Epoch. `weekday` zählt wie Pythons `tm_wday`: 0 = Montag.
 *
 * Rechnet in lokaler Zeit über Datumsarithmetik statt über Sekunden: eine
 * Zeitumstellung zwischen heute und dem Termin würde die Uhrzeit sonst um
 * eine Stunde verschieben.
 */
export function nextWeekdayHour(weekday: number, hour: number, now: number): number {
  const local = new Date(now * 1000);
  // getDay(): 0 = Sonntag. Auf Montag = 0 drehen.
  const today = (local.getDay() + 6) % 7;
  let days = (weekday - today + 7) % 7;
  const candidate = new Date(local);
  candidate.setHours(hour, 0, 0, 0);
  if (days === 0 && candidate.getTime() <= local.getTime()) days = 7;
  candidate.setDate(candidate.getDate() + days);
  candidate.setHours(hour, 0, 0, 0);
  return Math.floor(candidate.getTime() / 1000);
}

/** Der Zeitpunkt, ab dem der heutige Update-Slot vorbei ist (lokale Stunde).
 *  Liegt er noch in der Zukunft, zählt der von gestern — siehe
 *  backend/app/patch_scan.py, das dieselbe Rechnung macht. */
export function lastScanSlot(hour: number, now: number): number {
  const local = new Date(now * 1000);
  const slot = new Date(local);
  slot.setHours(hour, 0, 0, 0);
  if (slot.getTime() > local.getTime()) slot.setDate(slot.getDate() - 1);
  return Math.floor(slot.getTime() / 1000);
}

/** „am Montag, 15.09., um 03:00" */
export function whenLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const day = d.toLocaleDateString('de-DE', { weekday: 'long' });
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `am ${day}, ${date}, um ${time}`;
}
