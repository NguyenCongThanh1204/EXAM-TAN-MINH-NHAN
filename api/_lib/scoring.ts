export function scoreOutOfTen(score: number | null, total: number | null): number | null {
  if (score === null || total === null || total <= 0) return null;
  return Math.min(10, Math.max(0, (score / total) * 10));
}

export function scoreBucketOutOfTen(score: number | null, total: number | null): number | null {
  const normalized = scoreOutOfTen(score, total);
  if (normalized === null) return null;
  if (normalized < 5) return 0;
  if (normalized < 6.5) return 1;
  if (normalized < 8) return 2;
  if (normalized < 9) return 3;
  return 4;
}

export function passingScoreToPercentage(score: number): number {
  return Math.round(score * 10);
}

export function formatScoreOutOfTen(score: number | null, total: number | null): string {
  const normalized = scoreOutOfTen(score, total);
  return normalized === null ? '—' : normalized.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}
