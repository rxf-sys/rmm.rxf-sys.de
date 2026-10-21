import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useJobStream } from '../../hooks/useJobStream';
import { IconCheck, IconCopy } from '../../icons';
import type { JobStatus } from '../../types';
import { JOB_STATUS_LABEL } from './jobStatus';

const isTerminal = (s: JobStatus | null) => s === 'done' || s === 'failed' || s === 'timeout';

interface Props {
  jobId: number | null;
  title: ReactNode;
  /** The command line shown above the output. */
  command?: string;
  /** Text while no job is attached. */
  idle?: ReactNode;
  /** Controls in the header, e.g. "Leeren". */
  actions?: ReactNode;
  /** The input row of a terminal, rendered under the output. */
  children?: ReactNode;
  /** Told once a job has reached its end. */
  onFinished?: (status: JobStatus, exitCode: number | null) => void;
}

/**
 * Live output of one job. The output itself is a log that a screen reader
 * can browse but is not read out line by line; the status ("läuft",
 * "fertig, Exit 0") is announced once per change. The view follows new
 * output unless someone has scrolled up to read.
 */
export function JobConsole({ jobId, title, command, idle, actions, children, onFinished }: Props) {
  const stream = useJobStream(jobId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (stick && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [stream.output, stick]);

  const finishedRef = useRef<number | null>(null);
  useEffect(() => {
    if (jobId !== null && isTerminal(stream.status) && finishedRef.current !== jobId) {
      finishedRef.current = jobId;
      onFinished?.(stream.status!, stream.exitCode);
    }
  }, [jobId, stream.status, stream.exitCode, onFinished]);

  const running = stream.status === 'running' || stream.status === 'queued';
  const done = isTerminal(stream.status);
  const announce =
    jobId === null || stream.status === null
      ? ''
      : done
        ? `${JOB_STATUS_LABEL[stream.status]}${stream.exitCode !== null ? `, Exit ${stream.exitCode}` : ''}`
        : JOB_STATUS_LABEL[stream.status];

  const copy = () => {
    void navigator.clipboard?.writeText(stream.output).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="console">
      <div className="console-head">
        <span className="console-title">{title}</span>
        {jobId !== null && stream.status && (
          <span className={`console-state ${done ? (stream.status === 'done' ? 'ok' : 'err') : 'run'}`}>
            {JOB_STATUS_LABEL[stream.status]}
            {done && stream.exitCode !== null ? ` · Exit ${stream.exitCode}` : ''}
          </span>
        )}
        {jobId !== null && !stream.connected && running && <span className="console-state">verbindet …</span>}
        <span className="console-actions">
          {stream.output && (
            <button type="button" className="console-btn" onClick={copy}>
              {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          )}
          {actions}
        </span>
      </div>
      <span className="sr-only" role="status">
        {announce}
      </span>
      <div
        className="console-body"
        ref={bodyRef}
        role="log"
        aria-live="off"
        aria-label="Ausgabe"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the log scrolls; keyboard users need to reach it to scroll.
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
      >
        {jobId === null ? (
          <span className="console-line console-muted">{idle ?? 'Bereit.'}</span>
        ) : (
          <>
            {command && <span className="console-line console-cmd">$ {command}</span>}
            <span className="console-line">{stream.output || (running || stream.status === null ? '…' : '')}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
