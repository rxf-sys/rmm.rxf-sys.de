import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { qk } from '../../../api/queryClient';
import { useNow } from '../../../hooks/useNow';
import { MDM_STATUS, mdmStatus } from '../../../mdm';
import { MdmEnrollLink } from '../../../shell/enroll/MdmEnrollLink';
import type { Device } from '../../../types';
import { ErrorNote, Panel, SkeletonRows, StatusBadge } from '../../../ui';
import { MdmCommands, MdmPermissions } from './MdmDetails';
import { MdmConfigsPanel, MdmIdentityPanel, MdmOsUpdatePanel } from './MdmSettings';

/**
 * What can be set for an iPhone or iPad: its enrollment, its link to
 * Vulpexa (certificate), the permissions, the profiles on it and an enforced
 * iOS update — plus the history of what was sent. What the phone reports
 * stands on the overview; commands sit in the header menu.
 */
export function MdmTab({ device, isAdmin }: { device: Device; isAdmin: boolean }) {
  const now = useNow();
  const mdm = useQuery({
    queryKey: qk.deviceMdm(device.id),
    queryFn: ({ signal }) => api.deviceMdm(device.id, signal),
  });

  if (mdm.error) return <ErrorNote error={mdm.error} onRetry={() => void mdm.refetch()} />;
  if (!mdm.data) return <SkeletonRows rows={4} />;

  const { binding, needs_reenroll: needsReenroll } = mdm.data;
  const status = mdmStatus(mdm.data);
  const active = binding !== null && binding.checked_out_at === null;

  return (
    <div className="dv-grid">
      <Panel title="Registrierung">
        {isAdmin ? (
          <MdmEnrollLink deviceId={device.id} deviceName={device.hostname} />
        ) : (
          <div className="dv-mdm-status">
            <StatusBadge kind={MDM_STATUS[status].kind} label={MDM_STATUS[status].label} />
            <p className="dv-note">{MDM_STATUS[status].text}</p>
          </div>
        )}
        {needsReenroll && (
          <p className="dv-note">
            Mit einem älteren Privat-Profil registriert: Es erlaubt kein Löschen, und nachträglich lässt sich das
            nicht ergänzen. Dafür das Gerät neu registrieren — oder „Löschen“ unter MDM-Befugnisse abschalten.
          </p>
        )}
      </Panel>

      {binding && <MdmIdentityPanel deviceId={device.id} mdm={mdm.data} binding={binding} isAdmin={isAdmin} now={now} />}
      {active && <MdmConfigsPanel deviceId={device.id} mdm={mdm.data} isAdmin={isAdmin} />}
      {active && <MdmOsUpdatePanel deviceId={device.id} mdm={mdm.data} isAdmin={isAdmin} />}
      <MdmPermissions deviceId={device.id} mdm={mdm.data} isAdmin={isAdmin} />
      <MdmCommands mdm={mdm.data} now={now} />
    </div>
  );
}
