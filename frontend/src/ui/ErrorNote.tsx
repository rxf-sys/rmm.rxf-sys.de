import { apiErrorMessage } from '../api/client';
import { IconStatusDanger } from '../icons';

/** A failed request, said plainly, with a retry where one makes sense. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="err" role="alert">
      <IconStatusDanger size={15} />
      <span style={{ flex: 1 }}>{typeof error === 'string' ? error : apiErrorMessage(error)}</span>
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}
