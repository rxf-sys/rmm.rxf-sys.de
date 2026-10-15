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
            msg: 'Keine gültige RustDesk-ID',
            input: '12',
          },
        ],
      }),
    );
    const e = await errorOf(api.updateDevice(1, { rustdesk_id: '12' }));
    expect(apiErrorMessage(e)).toBe('Keine gültige RustDesk-ID');
  });

  it('falls back to the raw body when it is not JSON', async () => {
    failWith(502, 'Bad Gateway');
    const e = await errorOf(api.updateDevice(1, { rustdesk_id: '123456789' }));
    expect(apiErrorMessage(e)).toBe('Bad Gateway');
  });
});
