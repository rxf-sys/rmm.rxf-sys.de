import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { IconBell } from '../../icons';
import type { NtfyConfig } from '../../types';
import { ErrorNote, Panel, SkeletonRows, StatusBadge } from '../../ui';
import { notify } from '../../ui/toast';
import { adminKeys, explain } from './accounts';
import { NTFY_SOURCE, baseProblem, draftFrom, ntfyBody, ntfyDirty, tokenHint, type NtfyDraft } from './ntfy';

function NtfyForm({ cfg }: { cfg: NtfyConfig }) {
  const qc = useQueryClient();
  const id = useId();
  const [d, setD] = useState<NtfyDraft>(() => draftFrom(cfg));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const problem = baseProblem(d.base);
  const dirty = ntfyDirty(cfg, d);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || problem || busy) return;
    setBusy('save');
    setError(null);
    try {
      const next = await api.updateNtfy(ntfyBody(d));
      qc.setQueryData(adminKeys.ntfy, next);
      setD(draftFrom(next));
      if (next.source === 'none') notify.info('Push abgeschaltet', 'Alarme erscheinen weiter im Dashboard, nur ohne Nachricht aufs Telefon.');
      else if (next.source === 'env') notify.info('Eigene Einstellung entfernt', 'Es gilt wieder die Serverkonfiguration.');
      else notify.success('Push-Einstellung gespeichert', 'Eine Testnachricht zeigt, ob sie ankommt.');
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.testNtfy();
      if (r.ok) notify.success('Testnachricht gesendet', `Sie sollte gleich unter „${cfg.topic}“ ankommen.`);
      else notify.warning('Testnachricht nicht zugestellt', 'Der ntfy-Server hat sie nicht angenommen — Adresse, Topic und Token prüfen.');
    } catch (err) {
      notify.error('Test nicht möglich', explain(err));
    } finally {
      setBusy(null);
    }
  };

  // The test always uses what is stored, so it waits for a save.
  const testBlocked = cfg.source === 'none' ? 'Ohne Server gibt es nichts zu testen.' : dirty ? 'Der Test nutzt die gespeicherte Einstellung — erst speichern.' : null;

  return (
    <form className="form-stack" onSubmit={(e) => void save(e)} aria-label="ntfy einstellen" noValidate>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-base`}>
          Server-Adresse
        </label>
        <input
          id={`${id}-base`}
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={300}
          placeholder="https://ntfy.sh"
          value={d.base}
          onChange={(e) => setD({ ...d, base: e.target.value })}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-base-hint`}
        />
        {problem ? (
          <span className="field-error" id={`${id}-base-hint`}>
            {problem}
          </span>
        ) : (
          <span className="field-hint" id={`${id}-base-hint`}>
            Leer lassen schaltet Push ab — oder lässt wieder die Serverkonfiguration gelten, falls dort ein Server steht.
          </span>
        )}
      </div>
      <div className="form-2">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-topic`}>
            Topic
          </label>
          <input
            id={`${id}-topic`}
            className="input"
            autoComplete="off"
            spellCheck={false}
            maxLength={120}
            value={d.topic}
            onChange={(e) => setD({ ...d, topic: e.target.value })}
            aria-describedby={`${id}-topic-hint`}
          />
          <span className="field-hint" id={`${id}-topic-hint`}>
            Wer das Topic kennt, liest mit — auf öffentlichen Servern ein schwer zu erratendes wählen.
          </span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-token`}>
            Token <span className="ad-optional">optional</span>
          </label>
          <input
            id={`${id}-token`}
            className="input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            maxLength={500}
            value={d.token}
            disabled={d.dropToken}
            onChange={(e) => setD({ ...d, token: e.target.value })}
            aria-describedby={`${id}-token-hint`}
          />
          <span className="field-hint" id={`${id}-token-hint`}>
            {tokenHint(cfg, d)}
          </span>
          {cfg.source === 'ui' && cfg.has_token && (
            <label className="ad-check">
              <input type="checkbox" checked={d.dropToken} onChange={(e) => setD({ ...d, dropToken: e.target.checked, token: '' })} />
              Gespeicherten Token entfernen
            </label>
          )}
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="ad-actions">
        <button type="submit" className="btn btn-primary" disabled={!dirty || problem !== null || busy !== null}>
          {busy === 'save' ? 'Speichert …' : 'Speichern'}
        </button>
        <button type="button" className="btn" onClick={() => void test()} disabled={testBlocked !== null || busy !== null} aria-describedby={testBlocked ? `${id}-test` : undefined}>
          <IconBell size={14} /> {busy === 'test' ? 'Sendet …' : 'Testnachricht senden'}
        </button>
        {testBlocked && (
          <span className="ad-quiet" id={`${id}-test`}>
            {testBlocked}
          </span>
        )}
      </div>
    </form>
  );
}

/** Push for alarms over ntfy: where to, under which topic, with which token. */
export function NtfyPanel() {
  const q = useQuery({ queryKey: adminKeys.ntfy, queryFn: ({ signal }) => api.ntfyConfig(signal) });
  const src = q.data ? NTFY_SOURCE[q.data.source] : null;
  return (
    <Panel title="Push-Benachrichtigungen" meta={src && <StatusBadge kind={src.kind} label={src.label} plain />}>
      <p className="ad-text">Vulpexa schickt Alarme über ntfy aufs Telefon. Ohne Server bleiben sie im Dashboard sichtbar, nur ohne Nachricht.</p>
      {q.error ? (
        <ErrorNote error={explain(q.error)} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <SkeletonRows rows={3} h={36} />
      ) : (
        <NtfyForm cfg={q.data} />
      )}
    </Panel>
  );
}
