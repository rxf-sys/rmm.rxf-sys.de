import { formatRelative } from '../format';

interface Props {
  /** Fehlermeldung der letzten Abfrage, oder null, solange alles läuft. */
  error: string | null;
  /** Zeitpunkt der letzten erfolgreichen Abfrage. */
  loadedAt: number | null;
  onRetry: () => void;
}

/**
 * Sagt, wenn die angezeigten Zahlen nicht mehr aktuell sind.
 *
 * Bricht das Backend weg, laufen die Abfragen weiter ins Leere und das
 * Dashboard zeigte bisher kommentarlos den letzten bekannten Stand — man
 * sieht eine ruhige Flotte, obwohl man in Wahrheit gar nichts sieht. Genau
 * diese Art Stille hat beim Ausfall im September so lange gekostet.
 *
 * Deshalb: keine Fehlerseite, die den Blick auf die alten Daten nimmt,
 * sondern ein Streifen darüber, der den Stand datiert.
 */
export function ConnectionBanner({ error, loadedAt, onRetry }: Props) {
  if (error === null) return null;
  return (
    <div className="conn-banner" role="status">
      <span className="conn-dot" />
      <span className="conn-text">
        <b>Keine Verbindung zum Server.</b>{' '}
        {loadedAt === null
          ? 'Es konnten noch keine Daten geladen werden.'
          : `Angezeigt wird der Stand von ${formatRelative(loadedAt)}.`}
      </span>
      <span className="conn-detail mono">{error}</span>
      <button className="btn btn-sm" onClick={onRetry}>
        Erneut versuchen
      </button>
    </div>
  );
}
