import { describe, expect, it } from 'vitest';
import { formatMdmInfo, hasEraseRight, isAppleMobile, mdmStatus } from '../mdm';
import { visibleTabs } from '../pages/device/deviceTabs';
import type { MdmBinding, MdmEnrollment } from '../types';

const enrollment = (state: MdmEnrollment['state']): MdmEnrollment => ({
  id: 1,
  device_id: 1,
  access_rights: 8183,
  created_by: 'boss',
  created_at: 0,
  expires_at: 1,
  downloads: 0,
  downloaded_at: null,
  scep_at: null,
  enrolled_at: null,
  revoked_at: null,
  state,
});
const binding = (checkedOut: number | null): MdmBinding => ({
  udid: 'U',
  access_rights: 8191,
  enrolled_at: 1,
  last_seen_at: 1,
  checked_out_at: checkedOut,
  info: {},
  info_at: null,
});

describe('mdm', () => {
  it('only offers MDM for iPhone and iPad without agent', () => {
    expect(isAppleMobile({ device_class: 'mobile', os: 'ios' })).toBe(true);
    expect(isAppleMobile({ device_class: 'mobile', os: 'ipados' })).toBe(true);
    expect(isAppleMobile({ device_class: 'mobile', os: 'android' })).toBe(false);
    expect(isAppleMobile({ device_class: 'agent', os: 'ios' })).toBe(false);
  });

  it('shows the MDM tab exactly where it can do something', () => {
    const ids = (apple: boolean) =>
      visibleTabs({ isAdmin: false, isOperator: false, agent: false, apple }).map((t) => t.id);
    expect(ids(true)).toContain('mdm');
    expect(ids(false)).not.toContain('mdm');
    expect(visibleTabs({ isAdmin: true, isOperator: true, agent: true }).map((t) => t.id)).not.toContain('mdm');
  });

  it('lets the binding win over the enrollment', () => {
    expect(mdmStatus({ enrollment: null, binding: null })).toBe('none');
    expect(mdmStatus({ enrollment: enrollment('downloaded'), binding: null })).toBe('downloaded');
    expect(mdmStatus({ enrollment: enrollment('expired'), binding: binding(null) })).toBe('enrolled');
    expect(mdmStatus({ enrollment: enrollment('enrolled'), binding: binding(5) })).toBe('removed');
  });

  it('reads the erase bit', () => {
    expect(hasEraseRight(8191)).toBe(true);
    expect(hasEraseRight(8183)).toBe(false);
  });

  it('formats DeviceInformation values', () => {
    expect(formatMdmInfo('BatteryLevel', 0.83)).toMatch(/^83\s?%$/);
    expect(formatMdmInfo('BatteryLevel', -1)).toBe('unbekannt');
    expect(formatMdmInfo('DeviceCapacity', 119.2)).toBe('119,2 GB');
    expect(formatMdmInfo('IsSupervised', false)).toBe('nein');
    expect(formatMdmInfo('OSVersion', '18.7')).toBe('18.7');
  });
});
