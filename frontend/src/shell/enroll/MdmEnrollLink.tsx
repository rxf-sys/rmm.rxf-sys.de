import './enroll.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/queryClient';
import { formatDateTime } from '../../format';
import { IconCheck, IconCopy } from '../../icons';
import { MDM_STATUS, hasEraseRight, mdmStatus } from '../../mdm';
import type { CreatedMdmEnrollment } from '../../types';
import { ErrorNote, QrCode, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { copyText } from './agentDownload';
import { enrollErrorText } from './enrollText';

/** While a link is on screen and nothing has enrolled yet, look again this
 *  often. The fleet socket usually announces each step sooner. */
const WAIT_POLL_MS = 10_000;

interface Props {
  deviceId: number;
  deviceName: string;
  /** Start with a link right away (after "Gerät anlegen"), instead of
   *  waiting for a click. */
  autoCreate?: boolean;
}

/**
 * The admin's half of an iPhone enrollment: one click makes a one-time link,
 * shown as a QR code for the phone's camera. Everything after the scan runs
 * by itself — the status follows the phone from download to "Registriert".
 *
 * The raw link only exists in this component's state: the server keeps its
 * hash, so a reload means "make a new one", which also revokes this one.
 */
export function MdmEnrollLink({ deviceId, deviceName, autoCreate = false }: Props) {
  const qc = useQueryClient();
  const id = useId();
  const [created, setCreated] = useState<CreatedMdmEnrollment | null>(null);
  const [copied, setCopied] = useState(false);

  const mdm = useQuery({
    queryKey: qk.deviceMdm(deviceId),
    queryFn: ({ signal }) => api.deviceMdm(deviceId, signal),
    refetchInterval: (q) =>
      created && q.state.data && mdmStatus(q.state.data) !== 'enrolled' ? WAIT_POLL_MS : false,
  });

  const mint = useMutation({
    mutationFn: () => api.createMdmEnrollment(deviceId),
    onSuccess: (res) => {
      setCreated(res);
      void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
    },
  });

  const revoke = useMutation({
    mutationFn: () => api.revokeMdmEnrollment(deviceId),
    onSuccess: () => {
      setCreated(null);
      void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
      notify.success('Link widerrufen');
    },
  });

  // Once per mount, also under StrictMode's double effect: a second link
  // would revoke the first and leave a second audit entry.
  const autoDone = useRef(false);
  const { mutate: mintNow } = mint;
  const configured = mdm.data?.configured;
  useEffect(() => {
    if (!autoCreate || !configured || autoDone.current) return;
    autoDone.current = true;
    mintNow();
  }, [autoCreate, configured, mintNow]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (mdm.error) return <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />;
  if (!mdm.data) return <p className="muted">Lädt …</p>;

  if (!mdm.data.configured) {
    return (
      <p className="en-lead">
        MDM ist auf diesem Server noch nicht eingerichtet
        {mdm.data.missing.length > 0 && <> — es fehlt: {mdm.data.missing.join(', ')}</>}. Anleitung:
        docs/MDM-SETUP.md.
      </p>
    );
  }

  // The link on screen belongs to the newest enrollment; once that is used
  // up or replaced, showing it would only invite a scan that fails. While it
  // is live its state wins over an older binding (re-enrollment).
  const enr = mdm.data.enrollment;
  const live = !!created && enr?.id === created.enrollment.id && (enr.state === 'waiting' || enr.state === 'downloaded');
  const status = live && enr ? enr.state : mdmStatus(mdm.data);
  const meta = MDM_STATUS[status];
  const enrolled = status === 'enrolled';

  const copy = async () => {
    if (!created) return;
    if (await copyText(created.url)) setCopied(true);
    else notify.warning('Kopieren nicht möglich', 'Der Browser verweigert die Zwischenablage.');
  };

  return (
    <div className="en-mdm">
      <div className="en-mdm-status" role="status">
        <StatusBadge kind={meta.kind} label={meta.label} />
        <span className="field-hint">{meta.text}</span>
      </div>

      {live && created && (
        <div className="en-mdm-link">
          <QrCode value={created.url} label={`QR-Code: Registrierungslink für ${deviceName}`} />
          <div className="en-mdm-steps">
            <ol id={`${id}-steps`}>
              <li>Mit der Kamera des Geräts den Code scannen und den Link öffnen.</li>
              <li>„Zulassen“ tippen — das Profil wird geladen.</li>
              <li>
                Die Einstellungen öffnen, oben „Profil geladen“ wählen, „Installieren“ tippen, den Gerätecode
                eingeben und der Fernverwaltung vertrauen.
              </li>
            </ol>
            <p className="field-hint">
              Gültig bis {formatDateTime(created.enrollment.expires_at)}, für genau dieses Gerät.
              {!hasEraseRight(created.enrollment.access_rights) &&
                ' Das Profil eines Privatgeräts erlaubt kein Komplett-Löschen.'}
            </p>
            <div className="en-mdm-actions">
              <button type="button" className="btn btn-sm" onClick={() => void copy()}>
                {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                {copied ? 'Kopiert' : 'Link kopieren'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                aria-disabled={revoke.isPending || undefined}
                onClick={() => !revoke.isPending && revoke.mutate()}
              >
                Link widerrufen
              </button>
            </div>
            <span className="sr-only" role="status">
              {copied ? 'In die Zwischenablage kopiert' : ''}
            </span>
          </div>
        </div>
      )}

      {!live && !mint.isPending && (
        <div className="en-mdm-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => mint.mutate()}>
            {enrolled ? 'Neu registrieren' : status === 'none' ? 'Registrierungslink erzeugen' : 'Neuen Link erzeugen'}
          </button>
          {enrolled && (
            <span className="field-hint">
              Nur nötig, wenn das Gerät zurückgesetzt wurde oder ein anderes Profil braucht.
            </span>
          )}
        </div>
      )}
      {mint.isPending && <p className="muted">Link wird erzeugt …</p>}
      {mint.error && <ErrorNote error={enrollErrorText(mint.error)} />}
      {revoke.error && <ErrorNote error={revoke.error} />}
    </div>
  );
}
