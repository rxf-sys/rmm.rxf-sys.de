/** Achsen- und Reihenlogik der Verlaufsdiagramme.
 *
 * Getrennt von den Komponenten, damit diese nur Komponenten exportieren
 * (Fast Refresh, siehe deviceStatus.ts) — und damit sich die Regeln prüfen
 * lassen, ohne ein SVG zu rendern. Benutzt von der Flottenlast auf der
 * Übersicht und vom Metrik-Verlauf eines Geräts.
 */

/** Obergrenze der y-Achse: der nächste runde Wert über dem Höchstwert.
 *
 *  Eine feste 0–100-Skala war das eigentliche Problem des alten Diagramms: bei
 *  einer Flotte, die bei 5 bis 10 % dümpelt, klebt die Kurve am unteren Rand
 *  und ein Anstieg von 4 auf 11 % ist nicht zu sehen. */
export function niceCeiling(max: number): number {
  for (const step of [10, 25, 50]) if (max <= step) return step;
  return 100;
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
