import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
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
 * fault. This at least names the error and offers a reload.
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
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-loading" style={{ flexDirection: 'column', gap: 12, padding: 24 }}>
        <h2 style={{ margin: 0 }}>Etwas ist schiefgelaufen</h2>
        <p className="muted" style={{ maxWidth: 520, textAlign: 'center' }}>
          Die Oberfläche konnte nicht weiter dargestellt werden. Die Geräte melden weiter — betroffen
          ist nur diese Ansicht.
        </p>
        <pre
          className="mono"
          style={{ fontSize: 11, opacity: 0.7, maxWidth: 520, whiteSpace: 'pre-wrap' }}
        >
          {this.state.error.message}
        </pre>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
}
