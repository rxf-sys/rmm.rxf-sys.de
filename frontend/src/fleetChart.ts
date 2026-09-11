/** Achsen- und Reihenlogik des Flottenlast-Diagramms.
 *
 * Getrennt von OverviewPage.tsx, damit diese Datei nur Komponenten
 * exportiert (Fast Refresh, siehe deviceStatus.ts) — und damit sich die
 * beiden Regeln prüfen lassen, ohne ein SVG zu rendern.
 */

import type { FleetSample } from './types';

/** Obergrenze der y-Achse: der nächste runde Wert über dem Höchstwert.
 *
 *  Eine feste 0–100-Skala war das eigentliche Problem des alten Diagramms: bei
 *  einer Flotte, die bei 5 bis 10 % dümpelt, klebt die Kurve am unteren Rand
 *  und ein Anstieg von 4 auf 11 % ist nicht zu sehen. */
export function niceCeiling(max: number): number {
  for (const step of [10, 25, 50]) if (max <= step) return step;
  return 100;
}

/** Zusammenhängende Abschnitte: eine Lücke von mehr als einer Stunde wird
 *  nicht überbrückt. Sonst zöge die Linie quer durch eine Nacht, in der gar
 *  nichts gemessen wurde, und behauptete Messwerte, die es nicht gibt. */
export function segmentsOf(samples: FleetSample[]): FleetSample[][] {
  const out: FleetSample[][] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && s.ts - prev.ts <= 1.5 * 3600) last.push(s);
    else out.push([s]);
  }
  return out;
}
