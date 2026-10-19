import { WINDOWS_AGENT_PATH } from './enrollCommands';

export const AGENT_FILE_NAME = 'rmm-agent.exe';

/**
 * Fetch the Windows agent with the token in a header.
 *
 * Fetched by hand rather than as a plain download link, so a missing release
 * surfaces as the server's sentence ("kein Release hinterlegt") instead of a
 * browser download that silently saves the 404 body as "windows-amd64.json".
 */
export async function fetchWindowsAgent(origin: string, token: string): Promise<Blob> {
  const r = await fetch(`${origin}${WINDOWS_AGENT_PATH}`, {
    credentials: 'include',
    headers: { 'X-Enroll-Token': token },
  });
  if (!r.ok) {
    let detail = `Fehler ${r.status}`;
    try {
      const j = (await r.json()) as { detail?: unknown };
      if (typeof j.detail === 'string' && j.detail) detail = j.detail;
    } catch {
      // Not JSON (a proxy's error page): the status code is all there is.
    }
    throw new Error(detail);
  }
  return r.blob();
}

export const MDM_PROFILE_FILE_NAME = 'vulpexa-enrollment.mobileconfig';

/**
 * Fetch the MDM enrollment profile.
 *
 * Same reason as the agent above: while the push certificate or the SCEP
 * challenge is still missing, the server answers 409 with a sentence that
 * says which step is open. A plain download link would save that sentence
 * as a .mobileconfig and the phone would reject it without explanation.
 */
export async function fetchMdmProfile(): Promise<Blob> {
  const r = await fetch('/api/mdm/profile', { credentials: 'include' });
  if (!r.ok) {
    let detail = `Fehler ${r.status}`;
    try {
      const j = (await r.json()) as { detail?: unknown };
      if (typeof j.detail === 'string' && j.detail) detail = j.detail;
    } catch {
      // Not JSON (a proxy's error page): the status code is all there is.
    }
    throw new Error(detail);
  }
  return r.blob();
}

/** Hand a blob to the browser as a file download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Write to the clipboard; false when the browser refuses (plain http, a
 *  denied permission) so the caller can offer the manual way. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Select an element's text, ready for Ctrl+C when the clipboard is blocked. */
export function selectContents(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
