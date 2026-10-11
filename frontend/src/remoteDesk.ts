/**
 * RustDesk IDs as the server accepts them: the numeric ID RustDesk generates,
 * or a custom ID of letters, digits, '-' and '_'. The ID ends up in a
 * rustdesk:// link the browser hands to the local client, and it can come
 * from the agent — so anything else is not passed on.
 */
// Generated IDs are 6–12 digits; custom ones start with a letter. Without
// that, every 13–16 digit string slipped through the custom branch.
const RUSTDESK_ID = /^(?:[0-9]{6,12}|[A-Za-z][A-Za-z0-9_-]{5,15})$/;

/** Normalise what someone types: RustDesk shows IDs in groups of three. */
export function cleanRustdeskId(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function isRustdeskId(id: string): boolean {
  return RUSTDESK_ID.test(id);
}

/** The deep link, but only for a well-formed rustdesk:// ID. */
export function safeDeepLink(link: string): string | null {
  const m = /^rustdesk:\/\/(.+)$/.exec(link);
  return m && isRustdeskId(m[1]!) ? link : null;
}
