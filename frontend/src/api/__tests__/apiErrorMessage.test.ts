import { describe, expect, it } from 'vitest';
import { ApiError, apiErrorMessage } from '../client';

// Bodies as FastAPI 0.1xx / pydantic 2 send them for a rejected request
// (captured from a running app, inputs shortened).
const issue = (type: string, field: string | (string | number)[], msg: string, ctx?: Record<string, unknown>) => ({
  type,
  loc: ['body', ...(Array.isArray(field) ? field : [field])],
  msg,
  input: '',
  ...(ctx ? { ctx } : {}),
});
const rejected = (...detail: unknown[]) => new ApiError(422, JSON.stringify({ detail }));

describe('apiErrorMessage', () => {
  it('turns a FastAPI validation list into one German sentence', () => {
    const msg = apiErrorMessage(
      rejected(
        issue('string_too_short', 'name', 'String should have at least 1 character', { min_length: 1 }),
        issue('string_too_short', 'password', 'String should have at least 8 characters', { min_length: 8 }),
      ),
    );
    expect(typeof msg).toBe('string');
    expect(msg).toBe('Ungültige Eingabe: Name darf nicht leer sein; Passwort ist zu kurz (mindestens 8 Zeichen).');
  });

  it.each([
    ['missing', issue('missing', 'username', 'Field required'), 'Benutzername fehlt'],
    ['string_too_long', issue('string_too_long', 'hostname', 'String should have at most 255 characters', { max_length: 255 }), 'Gerätename ist zu lang (höchstens 255 Zeichen)'],
    ['greater_than_equal', issue('greater_than_equal', 'ttl_hours', 'Input should be greater than or equal to 1', { ge: 1 }), 'Gültigkeit muss mindestens 1 sein'],
    ['less_than_equal', issue('less_than_equal', 'hour', 'Input should be less than or equal to 23', { le: 23 }), 'Stunde darf höchstens 23 sein'],
    ['greater_than', issue('greater_than', 'threshold', 'Input should be greater than 0.5', { gt: 0.5 }), 'Schwelle muss größer als 0,5 sein'],
    ['int_parsing', issue('int_parsing', 'minutes', 'Input should be a valid integer'), 'Minuten muss eine ganze Zahl sein'],
    ['literal_error', issue('literal_error', 'shell', "Input should be 'bash' or 'powershell'", { expected: "'bash' or 'powershell'" }), 'Shell hat keinen erlaubten Wert'],
    ['string_pattern_mismatch', issue('string_pattern_mismatch', 'rustdesk_id', "String should match pattern '^\\d+$'"), 'RustDesk-ID hat ein ungültiges Format'],
    ['string_type', issue('string_type', ['patch_window', 'start'], 'Input should be a valid string'), '„patch_window.start“ muss Text sein'],
    ['dict_type', issue('dict_type', 'payload', 'Input should be a valid dictionary'), '„payload“ ist ungültig'],
  ])('words a %s violation', (_type, body, expected) => {
    expect(apiErrorMessage(rejected(body))).toBe(`Ungültige Eingabe: ${expected}.`);
  });

  it('passes the server’s own validator message on', () => {
    const msg = apiErrorMessage(rejected(issue('value_error', 'scope_kind', 'Value error, unbekannter Geltungsbereich: x', { error: {} })));
    expect(msg).toBe('Ungültige Eingabe: Geltungsbereich: unbekannter Geltungsbereich: x.');
  });

  it('says what was wrong with the request as a whole', () => {
    const msg = apiErrorMessage(
      rejected({ type: 'json_invalid', loc: ['body', 1], msg: 'JSON decode error', input: {}, ctx: { error: 'Expecting value' } }),
    );
    expect(msg).toBe('Ungültige Eingabe: Die Anfrage ist kein gültiges JSON.');
  });

  it('names the first three problems and counts the rest', () => {
    const missing = ['name', 'email', 'phone', 'notes', 'label'].map((f) => issue('missing', f, 'Field required'));
    expect(apiErrorMessage(rejected(...missing))).toBe(
      'Ungültige Eingabe: Name fehlt; E-Mail fehlt; Telefon fehlt und 2 weitere Angaben.',
    );
  });

  it('copes with list entries it does not understand', () => {
    expect(apiErrorMessage(rejected('kaputt', null, { loc: 'body' }))).toBe('Ungültige Eingabe: Die Anfrage ist ungültig.');
    expect(apiErrorMessage(rejected())).toBe('Ungültige Eingabe.');
  });

  it('keeps a plain detail and never passes on one that is no text', () => {
    expect(apiErrorMessage(new ApiError(404, '{"detail":"Gerät nicht gefunden"}'))).toBe('Gerät nicht gefunden');
    const odd = apiErrorMessage(new ApiError(400, '{"detail":{"code":7}}'));
    expect(typeof odd).toBe('string');
    expect(odd).toBe('Fehler 400');
  });
});
