import { describe, expect, it } from 'vitest';
import { csvCell, toCsvDocument } from '../csv';

describe('csvCell', () => {
  it('defuses cells a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-rf')).toBe("'-rf");
    expect(csvCell('@SUM')).toBe("'@SUM");
  });

  it('quotes separators, quotes, line breaks and edge spaces', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
  });

  it('writes numbers as they are and null as an empty cell', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
  });
});

describe('toCsvDocument', () => {
  it('starts with a byte-order mark and ends every line with CRLF', () => {
    expect(toCsvDocument(['A', 'B'], [['x', 1]])).toBe('\ufeffA;B\r\nx;1\r\n');
  });
});
