import { describe, expect, it } from 'vitest';
import { buildExamDashboard } from './dashboard.js';

describe('buildExamDashboard', () => {
  it('aggregates pass, fail, pending, score distribution, project and level metrics', () => {
    const dashboard = buildExamDashboard([
      { project_id: 'p1', main_project: 'Công trình A', candidate_level: 'Bậc 1', correct_count: 16, incorrect_count: 4, result: 'PASS' },
      { project_id: 'p1', main_project: 'Công trình A', candidate_level: 'Bậc 1', correct_count: 8, incorrect_count: 12, result: 'FAIL' },
      { project_id: 'p2', main_project: 'Công trình B', candidate_level: 'Bậc 2', correct_count: 0, incorrect_count: 0, result: null },
      { project_id: null, main_project: null, candidate_level: null, correct_count: null, incorrect_count: null, result: null },
    ], [
      { id: 'p1', name: 'Công trình A', active: true },
      { id: 'p2', name: 'Công trình B', active: false },
      { id: 'p3', name: 'Công trình C', active: true },
    ]);

    expect(dashboard.overall).toMatchObject({
      total: 4, pass: 1, fail: 1, pending: 2, graded: 2,
      averageScore: 6,
    });
    expect(dashboard.overall.scoreDistribution[8].count).toBe(1);
    expect(dashboard.overall.scoreDistribution[4].count).toBe(1);
    expect(dashboard.projects.find((project) => project.id === 'p1')).toMatchObject({
      total: 2, pass: 1, fail: 1, averageScore: 6,
    });
    expect(dashboard.projects.find((project) => project.id === 'p3')).toMatchObject({ total: 0 });
    expect(dashboard.levels.find((level) => level.level === 'Bậc 1')).toMatchObject({ total: 2, pass: 1, fail: 1 });
    expect(dashboard.levels.find((level) => level.level === 'Chưa khai báo')?.total).toBe(1);
    expect(dashboard.projectLevels).toHaveLength(2);
  });
});
