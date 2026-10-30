import { describe, expect, it } from 'vitest';
import { passingScoreToPercentage, scoreBucketOutOfTen, scoreOutOfTen } from './scoring.js';

describe('10-point scoring', () => {
  it('converts equal-weight question points to a score out of ten', () => {
    expect(scoreOutOfTen(1, 20)).toBe(0.5);
    expect(scoreOutOfTen(15, 20)).toBe(7.5);
    expect(scoreOutOfTen(20, 20)).toBe(10);
    expect(scoreOutOfTen(0, 0)).toBeNull();
  });

  it('buckets scores by whole-point ranges and converts pass thresholds to stored percentages', () => {
    expect(scoreBucketOutOfTen(1, 20)).toBe(0);
    expect(scoreBucketOutOfTen(10, 20)).toBe(5);
    expect(scoreBucketOutOfTen(20, 20)).toBe(10);
    expect(passingScoreToPercentage(7.5)).toBe(75);
    expect(passingScoreToPercentage(5.5)).toBe(55);
  });
});
