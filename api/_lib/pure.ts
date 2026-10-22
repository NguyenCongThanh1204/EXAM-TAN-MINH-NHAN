export const passThreshold = (n: number, pct: number) => Math.floor((n * pct + 99) / 100); // ceil, integer-safe
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const escapeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v);
export const remainingMs = (deadlineMs: number, offsetMs: number, clientNowMs: number) =>
  Math.max(0, deadlineMs - (clientNowMs + offsetMs));

export function isAllowedOrigin(origin: string | undefined, configured: string | undefined, host: string | undefined, protocol: string | undefined) {
  const normalize = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return url.origin;
    } catch {
      return null;
    }
  };
  const requestOrigin = origin ? normalize(origin) : null;
  if (!requestOrigin) return false;
  const allowed = configured?.split(',').some((value) => normalize(value.trim()) === requestOrigin);
  const currentOrigin = host && protocol ? normalize(`${protocol}://${host}`) : null;
  return !!allowed || requestOrigin === currentOrigin;
}
