export function remainingMs(deadline: number, offset: number, now: number): number {
  return Math.max(0, deadline - (now + offset));
}