import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { enrollErrorText, formatRemaining } from '../enrollText';

describe('formatRemaining', () => {
  const now = 1_000_000;

  it('says how long a token still works, in the coarsest useful unit', () => {
    expect(formatRemaining(now + 30, now)).toBe('noch 1 min gültig');
    expect(formatRemaining(now + 45 * 60, now)).toBe('noch 45 min gültig');
    expect(formatRemaining(now + 5 * 3600 + 59, now)).toBe('noch 5 h gültig');
    expect(formatRemaining(now + 47 * 3600, now)).toBe('noch 47 h gültig');
    expect(formatRemaining(now + 7 * 86400, now)).toBe('noch 7 Tage gültig');
  });

  it('calls a token at or past its end expired', () => {
    expect(formatRemaining(now, now)).toBe('abgelaufen');
    expect(formatRemaining(now - 10, now)).toBe('abgelaufen');
  });
});

describe('enrollErrorText', () => {
  it('explains a 403 instead of showing it raw', () => {
    expect(enrollErrorText(new ApiError(403, JSON.stringify({ detail: 'forbidden' })))).toBe(
      'Geräte hinzufügen dürfen nur Administratoren und Techniker.',
    );
  });

  it('passes the server sentence through otherwise', () => {
    expect(enrollErrorText(new ApiError(404, JSON.stringify({ detail: 'Token nicht gefunden' })))).toBe('Token nicht gefunden');
  });
});
