import { describe, expect, it } from 'vitest';
import { escapeCell, isAllowedOrigin, isCompanyEmail, normalizeEmail, passThreshold, remainingMs } from './pure';
describe('grading threshold', () => {
  it('50 questions @75% needs 38', () => expect(passThreshold(50, 75)).toBe(38));
  it('37 fails, 38/50 pass, 0 fails', () => { const t = passThreshold(50, 75); expect(37 >= t).toBe(false); expect(38 >= t).toBe(true); expect(50 >= t).toBe(true); expect(0 >= t).toBe(false); });
  it('rounds up', () => { expect(passThreshold(10, 75)).toBe(8); expect(passThreshold(7, 100)).toBe(7); });
});
describe('helpers', () => {
  it('normalizes email', () => expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com'));
  it('accepts only company email domains', () => {
    expect(isCompanyEmail('staff@tanminhnhan.com.vn')).toBe(true);
    expect(isCompanyEmail(' STAFF@TANMINHNHAN.COM.VN ')).toBe(true);
    expect(isCompanyEmail('staff@gmail.com')).toBe(false);
    expect(isCompanyEmail('staff@tanminhnhan.com.vn.example.org')).toBe(false);
  });
  it('blocks formula injection', () => { for (const c of ['=1+1', '+1', '-1', '@x']) expect(escapeCell(c).startsWith("'")).toBe(true); expect(escapeCell('An')).toBe('An'); });
  it('countdown uses server offset, not local clock', () => { expect(remainingMs(10_000, 5_000, 1_000)).toBe(4_000); expect(remainingMs(10_000, 0, 20_000)).toBe(0); });
  it('allows configured origins and the current deployment host', () => {
    expect(isAllowedOrigin('https://exam.example.com', 'https://other.example.com', 'exam.example.com', 'https')).toBe(true);
    expect(isAllowedOrigin('https://preview.vercel.app', 'https://exam.example.com', 'preview.vercel.app', 'https')).toBe(true);
    expect(isAllowedOrigin('https://exam.example.com', 'https://exam.example.com/', 'other.example.com', 'https')).toBe(true);
  });
  it('rejects missing, malformed, and cross-site origins', () => {
    expect(isAllowedOrigin(undefined, 'https://exam.example.com', 'exam.example.com', 'https')).toBe(false);
    expect(isAllowedOrigin('not-an-origin', 'https://exam.example.com', 'exam.example.com', 'https')).toBe(false);
    expect(isAllowedOrigin('https://attacker.example', 'https://exam.example.com', 'exam.example.com', 'https')).toBe(false);
    expect(isAllowedOrigin('https://exam.example.com/path', undefined, 'exam.example.com', 'https')).toBe(false);
  });
});
