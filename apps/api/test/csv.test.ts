import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/lib/csv.js';

describe('parseCsv', () => {
  it('parses plain rows with CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFname,phone\r\nKasun,0771234567\r\n')).toEqual([
      ['name', 'phone'],
      ['Kasun', '0771234567'],
    ]);
  });

  it('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('a,b\n"Perera, Kasun","He said ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['Perera, Kasun', 'He said "hi"\nthere'],
    ]);
  });

  it('keeps empty fields and skips blank lines', () => {
    expect(parseCsv('a,b,c\n\n1,,3\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('reads a last line without a newline, and Sinhala text', () => {
    expect(parseCsv('name\nකසුන් පෙරේරා')).toEqual([['name'], ['කසුන් පෙරේරා']]);
  });
});

describe('toCsv', () => {
  it('round-trips through parseCsv and blocks formulas but keeps negative numbers', () => {
    const rows = [
      ['name', 'note', 'amount'],
      ['Perera, Kasun', 'He said "hi"\nthere', '-1250.00'],
      ['=HYPERLINK("x")', '+94771234567', '@SUM(A1)'],
    ];
    const text = toCsv(rows);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(parseCsv(text)).toEqual([
      rows[0],
      rows[1],
      ['\'=HYPERLINK("x")', "'+94771234567", "'@SUM(A1)"],
    ]);
  });
});
