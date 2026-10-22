import { describe, expect, it } from 'vitest';
import { escapeCell, normalizeEmail, passThreshold, remainingMs } from './pure';
describe('grading threshold', () => {
  it('50 questions @75% needs 38', () => expect(passThreshold(50, 75)).toBe(38));
  it('37 fails, 38/50 pass, 0 fails', () => { const t = passThreshold(50, 75); expect(37 >= t).toBe(false); expect(38 >= t).toBe(true); expect(50 >= t).toBe(true); expect(0 >= t).toBe(false); });
  it('rounds up', () => { expect(passThreshold(10, 75)).toBe(8); expect(passThreshold(7, 100)).toBe(7); });
});
describe('helpers', () => {
  it('normalizes email', () => expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com'));
  it('blocks formula injection', () => { for (const c of ['=1+1', '+1', '-1', '@x']) expect(escapeCell(c).startsWith("'")).toBe(true); expect(escapeCell('An')).toBe('An'); });
  it('countdown uses server offset, not local clock', () => { expect(remainingMs(10_000, 5_000, 1_000)).toBe(4_000); expect(remainingMs(10_000, 0, 20_000)).toBe(0); });
});
