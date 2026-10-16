import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv.js';

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
