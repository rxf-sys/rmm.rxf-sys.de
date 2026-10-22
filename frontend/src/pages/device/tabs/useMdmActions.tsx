import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { IconDownload, IconLock, IconRestart, IconStatusDanger } from '../../../icons';
import { isAppleMobile } from '../../../mdm';
import type { Device, MdmAction } from '../../../types';
import type { MenuEntry } from '../../../ui';
import { notify } from '../../../ui/toast';
import { EraseDialog, InstallAppDialog, LockDialog } from './MdmDialogs';

type Dialog = 'lock' | 'erase' | 'clear_passcode' | 'install_app' | null;

/** Who may click what — the server checks the same (routers/mdm.py,
 *  routers/mdm_config.py). */
const ADMIN_ONLY: MdmAction[] = ['erase', 'clear_passcode'];

/**
 * The commands for one phone, as entries of the device header's menu plus
 * the dialogs they open. An entry the server would refuse stays in the menu,
 * disabled, with the server's reason as its hint — "why can't I lock this?"
 * deserves an answer. Entries the role cannot use are left out.
 *
 * No device yet, or no Apple phone: returns nothing and asks nothing. Called
 * before the device page knows its device (hooks come first).
 */
export function useMdmActions(
  deviceId: number,
  device: Device | undefined,
  { isAdmin, isOperator }: { isAdmin: boolean; isOperator: boolean },
): { entries: MenuEntry[]; dialogs: ReactNode } {
  const enabled = device !== undefined && isAppleMobile(device);
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const mdm = useQuery({
    queryKey: qk.deviceMdm(deviceId),
    queryFn: ({ signal }) => api.deviceMdm(deviceId, signal),
    enabled: enabled && isOperator,
  });
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: qk.deviceMdm(deviceId) });
    void qc.invalidateQueries({ queryKey: qk.devices });
  };
  const done = () => {
    setDialog(null);
    refreshAll();
  };
  const refresh = useMutation({
    mutationFn: () => api.mdmRefresh(deviceId),
    onSuccess: () => {
      notify.success('Abfrage verschickt', 'Die Antworten kommen, sobald das Gerät sich meldet.');
      refreshAll();
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });
  const clear = useMutation({
    mutationFn: () => api.mdmClearPasscode(deviceId),
    onSuccess: () => {
      notify.success('Code wird entfernt', 'Danach ist das Gerät ohne Code — bitte gleich einen neuen setzen lassen.');
      done();
    },
    onError: (e) => notify.error('Nicht verschickt', e),
  });

  const data = mdm.data;
  // Nothing for a phone that is not (or no longer) under MDM.
  if (!device || !enabled || !isOperator || !data?.binding || data.binding.checked_out_at)
    return { entries: [], dialogs: null };

  const allowed = (a: MdmAction) => (ADMIN_ONLY.includes(a) ? isAdmin : isOperator);
  const item = (action: MdmAction, label: string, icon: ReactNode, onSelect: () => void, danger = false): MenuEntry[] => {
    if (!allowed(action)) return [];
    const reason = data.actions[action];
    return [{ label, icon, onSelect, danger, disabled: reason !== null, hint: reason ?? undefined }];
  };
  const entries: MenuEntry[] = [
    { heading: 'Per MDM' },
    ...item('refresh', 'Inventar aktualisieren', <IconRestart size={14} />, () => refresh.mutate()),
    ...item('lock', 'Sperren …', <IconLock size={14} />, () => setDialog('lock')),
    ...item('install_app', 'App installieren …', <IconDownload size={14} />, () => setDialog('install_app')),
    ...item('clear_passcode', 'Code entfernen …', <IconLock size={14} />, () => setDialog('clear_passcode')),
    ...item('erase', 'Löschen …', <IconStatusDanger size={14} />, () => setDialog('erase'), true),
  ];

  const dialogs = (
    <>
      {dialog === 'lock' && <LockDialog device={device} onClose={() => setDialog(null)} onSent={done} />}
      {dialog === 'erase' && <EraseDialog device={device} onClose={() => setDialog(null)} onSent={done} />}
      {dialog === 'install_app' && <InstallAppDialog device={device} onClose={() => setDialog(null)} onSent={done} />}
      {dialog === 'clear_passcode' && (
        <ConfirmDialog
          title="Gerätecode entfernen"
          body={
            <p>
              Der Code von <strong>{device.hostname}</strong> wird gelöscht; wer das Gerät in der Hand hat, kommt danach
              ohne Code hinein. Gedacht für einen vergessenen Code — danach gleich einen neuen setzen lassen.
            </p>
          }
          confirmLabel="Code entfernen"
          danger
          busy={clear.isPending}
          onConfirm={() => clear.mutate()}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
  return { entries, dialogs };
}
