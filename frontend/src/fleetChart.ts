/** Achsen- und Reihenlogik der Verlaufsdiagramme.
 *
 * Getrennt von den Komponenten, damit diese nur Komponenten exportieren
 * (Fast Refresh, siehe deviceStatus.ts) — und damit sich die Regeln prüfen
 * lassen, ohne ein SVG zu rendern. Benutzt von der Flottenlast auf der
 * Übersicht und vom Metrik-Verlauf eines Geräts.
 */

/** Schritte, aus denen eine Prozentachse gebaut wird — alle „rund". */
const STEPS = [2, 5, 10, 20, 25];
/** Höchstens so viele Abschnitte, sonst wird das Raster bei 180 px Höhe dicht. */
const MAX_INTERVALS = 5;

/** y-Achse einer Prozentkurve: Obergrenze und Rasterschritt.
 *
 *  Eine feste 0–100-Skala war das eigentliche Problem des alten Diagramms: bei
 *  einer Flotte, die bei 5 bis 10 % dümpelt, klebt die Kurve am unteren Rand
 *  und ein Anstieg von 4 auf 11 % ist nicht zu sehen. Ein Zehntel Luft über
 *  der Spitze, damit sie nicht an der Oberkante klebt; die Obergrenze ist ein
 *  Vielfaches des Schritts, sodass jede Rasterlinie einen runden Wert trägt
 *  (nicht 13 und 38 wie bei Vierteln von 50). */
export function percentAxis(max: number, minTop = 10): { top: number; step: number } {
  const target = Math.max(minTop, max * 1.1);
  const step = STEPS.find((s) => Math.ceil(target / s) <= MAX_INTERVALS) ?? 25;
  return { top: Math.min(100, Math.ceil(target / step) * step), step };
}

/** Zusammenhängende Abschnitte: eine Lücke größer als `maxGapS` wird nicht
 *  überbrückt. Sonst zöge die Linie quer durch eine Nacht, in der gar nichts
 *  gemessen wurde, und behauptete Messwerte, die es nicht gibt.
 *
 *  Die Voreinstellung passt zu Stundenwerten (Flottenlast); der Verlauf eines
 *  einzelnen Geräts arbeitet mit Rohwerten im Minutentakt und gibt eine
 *  kleinere Lücke vor. */
export function segmentsOf<T extends { ts: number }>(samples: T[], maxGapS = 1.5 * 3600): T[][] {
  const out: T[][] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && s.ts - prev.ts <= maxGapS) last.push(s);
    else out.push([s]);
  }
  return out;
}
