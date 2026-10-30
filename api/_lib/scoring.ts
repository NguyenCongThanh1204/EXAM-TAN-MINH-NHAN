export function scoreOutOfTen(score: number | null, total: number | null): number | null {
  if (score === null || total === null || total <= 0) return null;
  return Math.min(10, Math.max(0, (score / total) * 10));
}

export function scoreBucketOutOfTen(score: number | null, total: number | null): number | null {
  const normalized = scoreOutOfTen(score, total);
  return normalized === null ? null : Math.min(10, Math.floor(normalized));
}

export function passingScoreToPercentage(score: number): number {
  return Math.round(score * 10);
}

export function formatScoreOutOfTen(score: number | null, total: number | null): string {
  const normalized = scoreOutOfTen(score, total);
  return normalized === null ? '—' : normalized.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}
