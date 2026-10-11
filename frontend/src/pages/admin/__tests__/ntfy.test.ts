import { describe, expect, it } from 'vitest';
import type { NtfyConfig } from '../../../types';
import { DEFAULT_TOPIC, baseProblem, draftFrom, ntfyBody, ntfyDirty, tokenHint } from '../ntfy';

const cfg = (over: Partial<NtfyConfig> = {}): NtfyConfig => ({ base: 'https://ntfy.sh', topic: 'fuchs', has_token: false, source: 'ui', ...over });

describe('ntfyBody', () => {
  it('keeps the stored token unless a new one is typed or removal is asked for', () => {
    const d = draftFrom(cfg());
    expect(ntfyBody(d)).toEqual({ base: 'https://ntfy.sh', topic: 'fuchs', token: null });
    expect(ntfyBody({ ...d, token: 'tk_1' }).token).toBe('tk_1');
    expect(ntfyBody({ ...d, token: 'tk_1', dropToken: true }).token).toBe('');
  });

  it('trims, and falls back to the default topic', () => {
    expect(ntfyBody({ base: '  https://push.example ', topic: '  ', token: '', dropToken: false })).toEqual({
      base: 'https://push.example',
      topic: DEFAULT_TOPIC,
      token: null,
    });
  });
});

describe('ntfyDirty', () => {
  it('is clean for what was loaded, dirty for any real change', () => {
    const c = cfg();
    const d = draftFrom(c);
    expect(ntfyDirty(c, d)).toBe(false);
    expect(ntfyDirty(c, { ...d, base: 'https://ntfy.sh ' })).toBe(false);
    expect(ntfyDirty(c, { ...d, topic: 'andere' })).toBe(true);
    expect(ntfyDirty(c, { ...d, token: 'x' })).toBe(true);
    expect(ntfyDirty(c, { ...d, dropToken: true })).toBe(true);
  });

  it('treats an empty topic from the server as the default', () => {
    const c = cfg({ topic: '' });
    expect(draftFrom(c).topic).toBe(DEFAULT_TOPIC);
    expect(ntfyDirty(c, draftFrom(c))).toBe(false);
  });
});

describe('baseProblem', () => {
  it('accepts empty and http(s) addresses only', () => {
    expect(baseProblem('')).toBeNull();
    expect(baseProblem('https://ntfy.sh')).toBeNull();
    expect(baseProblem('http://10.0.0.5:8080')).toBeNull();
    expect(baseProblem('ntfy.sh')).toMatch(/https:\/\//);
    expect(baseProblem('ftp://x')).not.toBeNull();
  });
});

describe('tokenHint', () => {
  it('warns that a token from .env does not carry over', () => {
    const c = cfg({ source: 'env', has_token: true });
    expect(tokenHint(c, draftFrom(c))).toContain('nicht übernommen');
  });

  it('says what an empty field does', () => {
    expect(tokenHint(cfg({ has_token: true }), draftFrom(cfg()))).toContain('Leer lassen');
    expect(tokenHint(cfg(), draftFrom(cfg()))).toContain('Nur nötig');
    expect(tokenHint(cfg({ has_token: true }), { ...draftFrom(cfg()), dropToken: true })).toContain('entfernt');
  });
});
