/**
 * The agent's inventory as the device page reads it.
 *
 * The server stores the inventory as the agent sends it, checking only its
 * size (devices.set_inventory), and the API schema passes it through. An
 * older, newer, custom or broken agent can therefore put an object where a
 * string belongs, and rendering that throws: the page's error boundary would
 * replace the whole device page for everyone who opens it. Each field is
 * checked here, once; one of the wrong type reads as not reported.
 */

const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
// Security states are words ("aktiv", "BitLocker"); a number there means nothing.
const word = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

export interface NicInfo {
  name: string;
  mac: string;
  ips: string[];
  mtu?: number;
  speed_mbit?: number;
}

export interface Hardware {
  platform: string;
  platform_version: string;
  kernel_version: string;
  cpu_model: string;
  cpu_threads?: number;
  mem_total_b?: number;
  manufacturer: string;
  model: string;
  serial: string;
  uptime_s?: number;
  nics: NicInfo[];
  /** Older agents report only the Wake-on-LAN MAC list. */
  macs: string[];
  gateway: string;
  dns: string[];
  security: { firewall: string; antivirus: string; encryption: string };
}

export function readHardware(data: unknown): Hardware {
  const hw = record(data);
  const security = record(hw.security);
  return {
    platform: text(hw.platform),
    platform_version: text(hw.platform_version),
    kernel_version: text(hw.kernel_version),
    cpu_model: text(hw.cpu_model),
    cpu_threads: num(hw.cpu_threads),
    mem_total_b: num(hw.mem_total_b),
    manufacturer: text(hw.manufacturer),
    model: text(hw.model),
    serial: text(hw.serial),
    uptime_s: num(hw.uptime_s),
    nics: (Array.isArray(hw.nics) ? hw.nics : []).flatMap((n): NicInfo[] => {
      const r = record(n);
      const name = text(r.name);
      return name ? [{ name, mac: text(r.mac), ips: texts(r.ips), mtu: num(r.mtu), speed_mbit: num(r.speed_mbit) }] : [];
    }),
    macs: texts(hw.macs),
    gateway: text(hw.gateway),
    dns: texts(hw.dns),
    security: { firewall: word(security.firewall), antivirus: word(security.antivirus), encryption: word(security.encryption) },
  };
}

export interface Package {
  name: string;
  version: string;
}

/** The installed packages; null when the agent sent no list at all. */
export function readSoftware(data: unknown): Package[] | null {
  if (!Array.isArray(data)) return null;
  return data.flatMap((p): Package[] => {
    const r = record(p);
    const name = text(r.name);
    return name ? [{ name, version: text(r.version) }] : [];
  });
}
