import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiErrorMessage } from '../api/client';

function failWith(status: number, body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status })),
  );
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the request to fail');
}

// As raised by routers/devices.py for a malformed RustDesk ID.
const RUSTDESK_HINT =
  'Keine gültige RustDesk-ID: 6–12 Ziffern oder 6–16 Zeichen, beginnend mit einem Buchstaben, aus A–Z, 0–9, _ und -';

describe('apiErrorMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the sentence a handler put in detail', async () => {
    failWith(409, JSON.stringify({ detail: 'Gerät ist nicht verbunden' }));
    const e = await errorOf(api.updateDevice(1, { rustdesk_id: '123456789' }));
    expect(apiErrorMessage(e)).toBe('Gerät ist nicht verbunden');
  });

  it('turns a request validation list into text instead of passing objects on', async () => {
    failWith(
      422,
      JSON.stringify({
        detail: [
          {
            type: 'rustdesk_id',
            loc: ['body', 'rustdesk_id'],
            msg: RUSTDESK_HINT,
            input: '12',
          },
        ],
      }),
    );
    const e = await errorOf(api.updateDevice(1, { rustdesk_id: '12' }));
    // The server's sentence names the accepted format; it must survive.
    expect(apiErrorMessage(e)).toBe(`Ungültige Eingabe: ${RUSTDESK_HINT}.`);
  });

  it('falls back to the raw body when it is not JSON', async () => {
    failWith(502, 'Bad Gateway');
    const e = await errorOf(api.updateDevice(1, { rustdesk_id: '123456789' }));
    expect(apiErrorMessage(e)).toBe('Bad Gateway');
  });
});
