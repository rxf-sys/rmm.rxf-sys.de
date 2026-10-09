/**
 * Runtime validation of the responses the dashboard cannot work without.
 *
 * TypeScript types are a promise the server never signed: a field renamed in
 * the backend, a `null` where a string was expected or an older agent that
 * reports less used to surface as a white page deep inside a component. Here
 * the shape is checked at the boundary instead.
 *
 * The schemas are deliberately forgiving: identity fields (id, hostname) are
 * required, everything else falls back to a neutral value when malformed, so
 * one odd field degrades one cell rather than the whole fleet view. Unknown
 * keys pass through untouched — a newer server must not break an older
 * dashboard.
 */
import * as z from 'zod/mini';
import type { Alert, Device, DeviceDetail, Heartbeat, PatchSummary } from '../types';

const str = (fallback = '') => z.catch(z.string(), fallback);
const num = (fallback = 0) => z.catch(z.number(), fallback);
const bool = (fallback = false) => z.catch(z.boolean(), fallback);
const numOrNull = () => z.catch(z.nullable(z.number()), null);
const optNum = () => z.catch(z.optional(z.number()), undefined);

const Disk = z.looseObject({
  mount: str(),
  used_pct: num(),
  used_b: optNum(),
  total_b: num(),
});

const HeartbeatSchema = z.catch(
  z.looseObject({
    ts: optNum(),
    agent_version: z.catch(z.optional(z.string()), undefined),
    cpu_pct: optNum(),
    mem_pct: optNum(),
    mem_used_b: optNum(),
    mem_total_b: optNum(),
    disks: z.catch(z.optional(z.array(Disk)), undefined),
    net_rx_bps: optNum(),
    net_tx_bps: optNum(),
    cpu_temp_c: optNum(),
    battery_pct: optNum(),
    logged_in_user: z.catch(z.optional(z.string()), undefined),
    reboot_required: z.catch(z.optional(z.boolean()), undefined),
  }),
  {},
);

export const DeviceSchema = z.looseObject({
  id: z.number(),
  hostname: z.string(),
  owner_label: str(),
  os: str(),
  os_version: str(),
  arch: str(),
  agent_version: str(),
  tags: z.catch(z.array(z.string()), []),
  heartbeat: HeartbeatSchema,
  rustdesk_id: str(),
  person_id: numOrNull(),
  maintenance_until: numOrNull(),
  created_at: num(),
  last_seen_at: numOrNull(),
  online: bool(),
  connected: bool(),
  agent_update_available: z.catch(z.nullable(z.string()), null),
  last_patch_scan_at: num(),
  device_class: z.catch(z.enum(['agent', 'mobile']), 'agent'),
  ownership: z.catch(z.enum(['', 'private', 'company']), ''),
  model: str(),
  serial: str(),
  imei: str(),
  notes: str(),
  checked_at: numOrNull(),
});

export const DevicesResponse = z.object({ devices: z.array(DeviceSchema) });

const InventorySection = z.catch(
  z.optional(z.looseObject({ data: z.unknown(), updated_at: num() })),
  undefined,
);

export const DeviceDetailResponse = z.object({
  device: DeviceSchema,
  inventory: z.catch(
    z.looseObject({ hardware: InventorySection, software: InventorySection }),
    {},
  ),
});

export const AlertSchema = z.looseObject({
  id: z.number(),
  device_id: z.number(),
  rule: str(),
  message: str(),
  fired_at: num(),
  resolved_at: numOrNull(),
  notified: bool(),
  acked_at: numOrNull(),
  acked_by: str(),
});

export const AlertsResponse = z.object({ alerts: z.array(AlertSchema) });

export const PatchSummaryResponse = z.object({
  summary: z.catch(
    z.record(z.string(), z.looseObject({ pending: num(), security: num() })),
    {},
  ),
});

/** Thrown when a response does not have the shape the screen needs. */
export class ResponseShapeError extends Error {
  constructor(
    public path: string,
    detail: string,
  ) {
    super(`Unerwartete Antwort von ${path}: ${detail}`);
    this.name = 'ResponseShapeError';
  }
}

/** Validate `data` against `schema`; the message names the first bad field. */
export function check<T>(schema: z.ZodMiniType<T>, path: string, data: unknown): T {
  const result = z.safeParse(schema, data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') : 'Antwort';
  throw new ResponseShapeError(path, `${where} – ${issue?.message ?? 'ungültig'}`);
}

// Compile-time guard: the validated shapes stay assignable to the types the
// screens use. A field added to types.ts without a schema entry fails here.
type Assert<T extends true> = T;
type Assignable<A, B> = A extends B ? true : false;
export type _DeviceOk = Assert<Assignable<z.infer<typeof DeviceSchema>, Device>>;
export type _HeartbeatOk = Assert<Assignable<z.infer<typeof HeartbeatSchema>, Heartbeat>>;
export type _DetailOk = Assert<Assignable<z.infer<typeof DeviceDetailResponse>, DeviceDetail>>;
export type _AlertOk = Assert<Assignable<z.infer<typeof AlertSchema>, Alert>>;
export type _SummaryOk = Assert<
  Assignable<z.infer<typeof PatchSummaryResponse>['summary'], PatchSummary>
>;
