import { describe, expect, it } from 'vitest';
import { amountInWords } from './FeeReceiptDialog';

describe('amountInWords', () => {
  it('writes whole dollars', () => {
    expect(amountInWords(0)).toBe('Zero dollars');
    expect(amountInWords(1)).toBe('One dollar');
    expect(amountInWords(40)).toBe('Forty dollars');
    expect(amountInWords(55)).toBe('Fifty-five dollars');
    expect(amountInWords(120)).toBe('One hundred twenty dollars');
  });

  it('writes thousands and cents', () => {
    expect(amountInWords(1250.5)).toBe('One thousand two hundred fifty dollars and 50 cents');
    expect(amountInWords(2000)).toBe('Two thousand dollars');
    expect(amountInWords(1_000_001.01)).toBe('One million one dollars and 1 cent');
  });
});
