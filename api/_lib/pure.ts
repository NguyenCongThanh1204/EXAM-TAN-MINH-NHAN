export const passThreshold = (n: number, pct: number) => Math.floor((n * pct + 99) / 100); // ceil, integer-safe
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const escapeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v);
export const remainingMs = (deadlineMs: number, offsetMs: number, clientNowMs: number) =>
  Math.max(0, deadlineMs - (clientNowMs + offsetMs));
