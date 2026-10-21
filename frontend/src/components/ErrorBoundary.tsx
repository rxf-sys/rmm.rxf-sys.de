import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 'app' replaces the whole screen; 'page' sits inside the shell, so a
   *  crash on one page leaves navigation, alerts and the rest usable. */
  variant?: 'app' | 'page';
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence for a render-time crash.
 *
 * Without one, a single throw in any component unmounts the whole tree and
 * leaves a blank page — no message, no way back, and for an operator staring
 * at a fleet dashboard, no clue whether the server or the browser is at
 * fault. This at least names the error and offers a way out. The app puts one
 * around every route (keyed by path, so navigating away resets it) and one
 * around everything.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // The browser console is the only sink available here; there is no
    // client-side error reporting endpoint and adding one would send
    // dashboard state off the machine.
    console.error('Unbehandelter Fehler im Dashboard:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const page = this.props.variant === 'page';
    return (
      <div className={page ? 'crash crash-page' : 'crash'} role="alert">
        <h2>{page ? 'Diese Ansicht ist abgestürzt' : 'Etwas ist schiefgelaufen'}</h2>
        <p>
          {page
            ? 'Der Rest des Dashboards läuft weiter. Die Geräte melden weiter — betroffen ist nur diese Seite.'
            : 'Die Oberfläche konnte nicht weiter dargestellt werden. Die Geräte melden weiter — betroffen ist nur diese Ansicht.'}
        </p>
        <pre className="mono">{error.message}</pre>
        <div className="crash-actions">
          {page && (
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Erneut versuchen
            </button>
          )}
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
