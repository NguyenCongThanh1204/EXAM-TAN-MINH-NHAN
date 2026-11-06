// Run against STAGING only. Prepare one unused allowlisted email per VU.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
const vus = Number(__ENV.VUS || 180);
const jitterSeconds = Number(__ENV.JITTER_SECONDS || 20);
const testMode = __ENV.TEST_MODE || 'standard';
const soakMode = testMode === 'soak';
const syncStart = __ENV.SYNC_START === 'true' || soakMode;
const syncLeadSeconds = Number(__ENV.SYNC_LEAD_SECONDS || 10);
const submitAfterSeconds = Number(__ENV.SUBMIT_AFTER_SECONDS || 180);
const soakMinutes = Number(__ENV.SOAK_MINUTES || 20);
const soakIntervalSeconds = Number(__ENV.SOAK_INTERVAL_SECONDS || 120);
const answerJitterSeconds = Number(__ENV.ANSWER_JITTER_SECONDS || 30);
const emails = __ENV.EMAIL_FILE
  ? open(__ENV.EMAIL_FILE).split(/\r?\n/).map((email) => email.trim()).filter(Boolean)
  : Array.from({ length: vus }, (_, index) => `load${index + 1}@tanminhnhan.com.vn`);
if (!Number.isInteger(vus) || vus < 1 || vus > 199) throw new Error('VUS must be an integer between 1 and 199');
if (!['standard', 'soak'].includes(testMode)) throw new Error('TEST_MODE must be standard or soak');
if (!Number.isFinite(jitterSeconds) || jitterSeconds < 0) throw new Error('JITTER_SECONDS must be zero or greater');
if (!Number.isFinite(syncLeadSeconds) || syncLeadSeconds < 0) throw new Error('SYNC_LEAD_SECONDS must be zero or greater');
if (!Number.isFinite(submitAfterSeconds) || submitAfterSeconds <= 0) throw new Error('SUBMIT_AFTER_SECONDS must be greater than zero');
if (!Number.isFinite(soakMinutes) || soakMinutes <= 0 || soakMinutes > 20) throw new Error('SOAK_MINUTES must be greater than zero and at most 20');
if (!Number.isFinite(soakIntervalSeconds) || soakIntervalSeconds <= 0) throw new Error('SOAK_INTERVAL_SECONDS must be greater than zero');
if (!Number.isFinite(answerJitterSeconds) || answerJitterSeconds < 0) throw new Error('ANSWER_JITTER_SECONDS must be zero or greater');
if (!__ENV.BASE || !__ENV.ORIGIN) throw new Error('Set BASE and ORIGIN to the staging deployment before running this test');
if (emails.length < vus) throw new Error(`EMAIL_FILE must contain at least ${vus} email addresses`);
if (new Set(emails).size !== emails.length) throw new Error('EMAIL_FILE contains duplicate email addresses');
if (emails.some((email) => !/^[^\s@]+@tanminhnhan\.com\.vn$/i.test(email))) throw new Error('EMAIL_FILE contains an invalid company email');
const project = __ENV.PROJECT || 'Staging';
const startRequestOffset = new Trend('start_request_offset_ms');
const submitRequestOffset = new Trend('submit_request_offset_ms');
const startDuration = new Trend('start_duration_ms');
const stateDuration = new Trend('state_duration_ms');
const answerBatchDuration = new Trend('answer_batch_duration_ms');
const soakBatchDuration = new Trend('soak_batch_duration_ms');
const submitDuration = new Trend('submit_duration_ms');
export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '25m' } },
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800', 'p(99)<2000'] },
};
const H = { headers: { 'Content-Type': 'application/json', Origin: __ENV.ORIGIN } };
const sleepUntil = (timestamp) => {
  const remainingMs = timestamp - Date.now();
  if (remainingMs > 0) sleep(remainingMs / 1000);
};
export function setup() {
  const startAt = Date.now() + syncLeadSeconds * 1000;
  const examDurationSeconds = soakMode ? soakMinutes * 60 : submitAfterSeconds;
  return { startAt, submitAt: startAt + examDurationSeconds * 1000 };
}
export default function (schedule) {
  if (syncStart) {
    sleepUntil(schedule.startAt);
    startRequestOffset.add(Date.now() - schedule.startAt);
  } else {
    sleep(Math.random() * jitterSeconds);
  }
  const candidate = {
    fullName: `Load ${__VU}`, email: emails[__VU - 1], position: 'Tester',
    level: 'Load test', mainProject: project,
  };
  const s = http.post(`${__ENV.BASE}/api/exam/start`, JSON.stringify(candidate), H);
  startDuration.add(s.timings.duration);
  if (!check(s, { started: (r) => r.status === 201 })) return;
  const state = http.get(`${__ENV.BASE}/api/exam/state`);
  stateDuration.add(state.timings.duration);
  if (!check(state, { 'state loaded': (r) => r.status === 200 })) return;
  const st = state.json();
  let batch = [];
  for (const q of st.questions) {
    batch.push(q.type === 'essay'
      ? { questionId: q.id, essay: 'Load test response' }
      : { questionId: q.id, optionIds: [q.options[0].id] });
    sleep(1 + Math.random() * 4);
    if (batch.length === 5) {
      const saved = http.put(`${__ENV.BASE}/api/exam/answers`, JSON.stringify({ answers: batch }), H);
      answerBatchDuration.add(saved.timings.duration);
      if (!check(saved, { 'answer batch saved': (r) => r.status === 200 })) return;
      batch = [];
    }
  }
  if (batch.length) {
    const saved = http.put(`${__ENV.BASE}/api/exam/answers`, JSON.stringify({ answers: batch }), H);
    answerBatchDuration.add(saved.timings.duration);
    if (!check(saved, { 'answer batch saved': (r) => r.status === 200 })) return;
  }
  if (soakMode) {
    const stopAnsweringAt = schedule.submitAt - 15000;
    const batchSize = Math.min(5, st.questions.length);
    let cycle = 0;
    let nextBatchAt = schedule.startAt + soakIntervalSeconds * 1000;
    while (nextBatchAt < stopAnsweringAt) {
      sleepUntil(nextBatchAt + Math.random() * answerJitterSeconds * 1000);
      if (Date.now() >= stopAnsweringAt) break;
      const updates = [];
      for (let offset = 0; offset < batchSize; offset++) {
        const q = st.questions[(cycle * batchSize + offset) % st.questions.length];
        if (q.type === 'essay') {
          updates.push({ questionId: q.id, essay: `Load test response ${cycle + 1}` });
        } else {
          const option = q.options[cycle % q.options.length];
          updates.push({ questionId: q.id, optionIds: [option.id] });
        }
        sleep(1 + Math.random() * 4);
      }
      const saved = http.put(`${__ENV.BASE}/api/exam/answers`, JSON.stringify({ answers: updates }), H);
      soakBatchDuration.add(saved.timings.duration);
      if (!check(saved, { 'soak answer batch saved': (r) => r.status === 200 })) return;
      cycle++;
      nextBatchAt = Date.now() + soakIntervalSeconds * 1000;
    }
  }
  if (syncStart) {
    sleepUntil(schedule.submitAt);
    submitRequestOffset.add(Date.now() - schedule.submitAt);
  }
  const r = http.post(`${__ENV.BASE}/api/exam/submit`, JSON.stringify({ reason: 'manual' }), H);
  submitDuration.add(r.timings.duration);
  check(r, { submitted: (x) => x.status === 200 });
}
