import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorMessage } from '../client';

/** What FastAPI answers when a request breaks a declared limit. */
const validation = (...issues: object[]) => new ApiError(422, JSON.stringify({ detail: issues }));

describe('apiErrorMessage', () => {
  it("passes the server's own sentence through", () => {
    expect(apiErrorMessage(new ApiError(409, '{"detail":"Benutzername bereits vergeben"}'))).toBe('Benutzername bereits vergeben');
  });

  it("turns FastAPI's validation list into one sentence naming the field and the limit", () => {
    const msg = apiErrorMessage(
      validation({
        type: 'string_too_long',
        loc: ['query', 'q'],
        msg: 'String should have at most 200 characters',
        input: 'x'.repeat(201),
        ctx: { max_length: 200 },
      }),
    );
    expect(typeof msg).toBe('string');
    expect(msg).toBe('Ungültige Eingabe: Suchbegriff ist zu lang (höchstens 200 Zeichen).');
  });

  it('names every refused field, and what is missing', () => {
    const msg = apiErrorMessage(
      validation(
        { type: 'string_too_short', loc: ['body', 'password'], msg: 'x', ctx: { min_length: 8 } },
        { type: 'missing', loc: ['body', 'username'], msg: 'Field required' },
        { type: 'int_parsing', loc: ['path', 'user_id'], msg: 'x' },
      ),
    );
    expect(msg).toBe('Ungültige Eingabe: Passwort ist zu kurz (mindestens 8 Zeichen); Benutzername fehlt; „user_id“ muss eine ganze Zahl sein.');
  });

  it('never hands back a detail that is not text', () => {
    expect(apiErrorMessage(new ApiError(500, '{"detail":{"code":7}}'))).toBe('Fehler 500');
    expect(apiErrorMessage(new ApiError(422, '{"detail":[]}'))).toBe('Ungültige Eingabe.');
  });

  it('keeps a body that is not JSON, and says when the server is gone', () => {
    expect(apiErrorMessage(new ApiError(502, 'Bad Gateway'))).toBe('Bad Gateway');
    expect(apiErrorMessage(new ApiError(502, ''))).toBe('Fehler 502');
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe('Server nicht erreichbar');
  });
});
