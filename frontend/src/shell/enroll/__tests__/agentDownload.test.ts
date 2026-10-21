import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, fetchWindowsAgent } from '../agentDownload';

const origin = 'https://rmm.example.org';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWindowsAgent', () => {
  it('asks for the binary with the token in a header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('MZ', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchWindowsAgent(origin, 'tok-1');
    expect(await blob.text()).toBe('MZ');
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/agent/setup/download/windows-amd64`, {
      credentials: 'include',
      headers: { 'X-Enroll-Token': 'tok-1' },
    });
  });

  it('turns a missing release into the server sentence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ detail: 'kein Release hinterlegt' }), { status: 404 })),
    );
    await expect(fetchWindowsAgent(origin, 't')).rejects.toThrow('kein Release hinterlegt');
  });

  it('falls back to the status when a proxy answers with a page', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(fetchWindowsAgent(origin, 't')).rejects.toThrow('Fehler 502');
  });
});

describe('copyText', () => {
  it('reports whether the browser let it write', async () => {
    const writeText = vi.fn<(t: string) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('a')).toBe(true);
    expect(await copyText('b')).toBe(false);
    expect(writeText).toHaveBeenCalledWith('a');
  });
});
