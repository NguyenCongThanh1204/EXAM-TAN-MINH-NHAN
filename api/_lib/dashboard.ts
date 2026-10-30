import { scoreOutOfTen } from './scoring.js';

export type DashboardAttempt = {
  project_id: string | null;
  main_project: string | null;
  candidate_level: string | null;
  correct_count: number | null;
  incorrect_count: number | null;
  result: string | null;
};

export type DashboardProject = { id: string; name: string; active: boolean };
export type ScoreBucket = { label: string; count: number };
export type DashboardMetric = {
  total: number;
  pass: number;
  fail: number;
  pending: number;
  graded: number;
  averageScore: number | null;
  scoreDistribution: ScoreBucket[];
};
export type DashboardGroup<T> = T & DashboardMetric;
export type ExamDashboard = {
  overall: DashboardMetric;
  projects: DashboardGroup<DashboardProject>[];
  levels: DashboardGroup<{ level: string }>[];
  projectLevels: DashboardGroup<{ projectId: string; level: string }>[];
};

const SCORE_BUCKETS = [
  '0.0–0.9', '1.0–1.9', '2.0–2.9', '3.0–3.9', '4.0–4.9', '5.0–5.9',
  '6.0–6.9', '7.0–7.9', '8.0–8.9', '9.0–9.9', '10',
];

export function buildExamDashboard(attempts: DashboardAttempt[], projects: DashboardProject[]): ExamDashboard {
  const createMetric = (): DashboardMetric => ({
    total: 0, pass: 0, fail: 0, pending: 0, graded: 0,
    averageScore: null,
    scoreDistribution: SCORE_BUCKETS.map((label) => ({ label, count: 0 })),
  });
  const accumulators = new WeakMap<DashboardMetric, { score: number }>();
  const makeAccumulator = () => {
    const metric = createMetric();
    accumulators.set(metric, { score: 0 });
    return metric;
  };
  const add = (metric: DashboardMetric, attempt: DashboardAttempt) => {
    metric.total += 1;
    if (attempt.result === 'PASS') metric.pass += 1;
    else if (attempt.result === 'FAIL') metric.fail += 1;
    else metric.pending += 1;

    const mcTotal = (attempt.correct_count ?? 0) + (attempt.incorrect_count ?? 0);
    const score = scoreOutOfTen(attempt.correct_count, mcTotal);
    if (score === null) return;
    const totals = accumulators.get(metric);
    if (!totals) throw new Error('Dashboard metric accumulator is missing.');
    totals.score += score;
    metric.graded += 1;
    metric.scoreDistribution[Math.min(10, Math.floor(score))].count += 1;
  };
  const finish = (metric: DashboardMetric) => {
    const totals = accumulators.get(metric);
    if (!totals) throw new Error('Dashboard metric accumulator is missing.');
    if (metric.graded > 0) {
      metric.averageScore = totals.score / metric.graded;
    }
    return metric;
  };

  const projectMap = new Map(projects.map((project) => [project.id, {
    ...project, metric: makeAccumulator(),
  }]));
  const levelMap = new Map<string, DashboardMetric>();
  const projectLevelMap = new Map<string, { projectId: string; level: string; metric: DashboardMetric }>();
  const overall = makeAccumulator();

  for (const attempt of attempts) {
    add(overall, attempt);
    const level = attempt.candidate_level?.trim() || 'Chưa khai báo';
    let levelEntry = levelMap.get(level);
    if (!levelEntry) {
      levelEntry = makeAccumulator();
      levelMap.set(level, levelEntry);
    }
    add(levelEntry, attempt);

    if (!attempt.project_id) continue;
    let projectEntry = projectMap.get(attempt.project_id);
    if (!projectEntry) {
      projectEntry = {
        id: attempt.project_id,
        name: attempt.main_project?.trim() || 'Công trình không xác định',
        active: false,
        metric: makeAccumulator(),
      };
      projectMap.set(attempt.project_id, projectEntry);
    }
    add(projectEntry.metric, attempt);

    const key = `${attempt.project_id}\u0000${level}`;
    let pair = projectLevelMap.get(key);
    if (!pair) {
      pair = { projectId: attempt.project_id, level, metric: makeAccumulator() };
      projectLevelMap.set(key, pair);
    }
    add(pair.metric, attempt);
  }

  const projectsOut = [...projectMap.values()]
    .map(({ metric, ...project }) => ({ ...project, ...finish(metric) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const levelsOut = [...levelMap.entries()]
    .map(([level, metric]) => ({ level, ...finish(metric) }))
    .sort((a, b) => a.level.localeCompare(b.level, 'vi'));
  const projectLevels = [...projectLevelMap.values()]
    .map(({ metric, ...group }) => ({ ...group, ...finish(metric) }))
    .sort((a, b) => a.level.localeCompare(b.level, 'vi'));

  return { overall: finish(overall), projects: projectsOut, levels: levelsOut, projectLevels };
}
