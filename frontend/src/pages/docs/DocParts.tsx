import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconChevronRight, IconCopy, IconInfo } from '../../icons';
import { notify } from '../../ui/toast';
import { codeLines, isCommentLine } from './docSections';

/**
 * A command to paste somewhere else, in the console style of the job
 * output. Long lines wrap with a hanging indent, so a wrapped line never
 * looks like the next command. Copying takes the exact text; where the
 * browser refuses the clipboard (plain http on the LAN), the command is
 * selected instead, ready for Ctrl+C.
 */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const refused = () => {
    if (preRef.current) window.getSelection()?.selectAllChildren(preRef.current);
    notify.warning('Nicht kopiert', 'Der Browser gibt die Zwischenablage nicht frei. Der Befehl ist markiert — mit Strg+C kopieren.');
  };

  const copy = () => {
    if (!navigator.clipboard) {
      refused();
      return;
    }
    navigator.clipboard.writeText(code).then(() => setCopied(true), refused);
  };

  return (
    <div className="console dc-code">
      <div className="console-head dc-code-head">
        <span className="dc-code-label">{label}</span>
        <span className="console-actions">
          {/* A dozen buttons on this page say "Kopieren"; the name carries the
              label too, so a list of buttons tells them apart. It starts with
              the visible word, so voice control still finds it. */}
          <button type="button" className="console-btn" onClick={copy} aria-label={`${copied ? 'Kopiert' : 'Kopieren'}: ${label}`}>
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copied ? 'Kopiert' : 'Kopieren'}
          </button>
        </span>
      </div>
      <pre ref={preRef} className="dc-code-body">
        <code>
          {codeLines(code).map((line, i) => (
            <span key={i} className={isCommentLine(line) ? 'dc-line dc-comment' : 'dc-line'}>
              {line || ' '}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      <span className="sr-only" role="status">
        {copied ? 'In die Zwischenablage kopiert' : ''}
      </span>
    </div>
  );
}

/** Background and caveats beside the main path. Neutral on purpose: a note
 *  is not a warning, and colour would make every note shout. */
export function Note({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="dc-note" role="note">
      <span className="dc-note-ico">
        <IconInfo size={16} />
      </span>
      <div className="dc-note-body">
        {title && <p className="dc-note-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Numbered steps. The number is real text for screen readers („Schritt 2“)
 *  and a quiet figure in the gutter for everyone else. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="dc-steps">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="dc-step">
      <span className="dc-step-n num" aria-hidden>
        {n}
      </span>
      <div className="dc-step-body">
        <h3 className="dc-h3">
          <span className="sr-only">Schritt {n}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/** One known error: the message as it appears, then what to do. */
export function FaqItem({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="dc-faq-item">
      <h3 className="dc-h3">{title}</h3>
      {children}
    </div>
  );
}

/** A click path through menus. Chevrons for the eye, commas for the ear. */
export function Path({ parts }: { parts: readonly string[] }) {
  return (
    <span className="dc-path">
      {parts.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && (
            <>
              <span className="dc-path-sep">
                <IconChevronRight size={12} />
              </span>
              <span className="sr-only">, </span>
            </>
          )}
          <b>{p}</b>
        </Fragment>
      ))}
    </span>
  );
}
