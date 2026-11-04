// Run against STAGING only. Import load${__VU}@tanminhnhan.com.vn for each VU first.
import http from 'k6/http';
import { check, sleep } from 'k6';
const vus = Number(__ENV.VUS || 180);
const jitterSeconds = Number(__ENV.JITTER_SECONDS || 20);
if (!Number.isInteger(vus) || vus < 1 || vus > 199) throw new Error('VUS must be an integer between 1 and 199');
if (!Number.isFinite(jitterSeconds) || jitterSeconds < 0) throw new Error('JITTER_SECONDS must be zero or greater');
if (!__ENV.BASE || !__ENV.ORIGIN) throw new Error('Set BASE and ORIGIN to the staging deployment before running this test');
export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '15m' } },
  thresholds: { checks: ['rate>0.99'], http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800', 'p(99)<2000'] },
};
const H = { headers: { 'Content-Type': 'application/json', Origin: __ENV.ORIGIN } };
export default function () {
  sleep(Math.random() * jitterSeconds); // spread arrivals across the selected burst window
  const candidate = {
    fullName: `Load ${__VU}`, email: `load${__VU}@tanminhnhan.com.vn`, position: 'Tester',
    level: 'Load test', mainProject: 'Staging',
  };
  const s = http.post(`${__ENV.BASE}/api/exam/start`, JSON.stringify(candidate), H);
  if (!check(s, { started: (r) => r.status === 201 })) return;
  const state = http.get(`${__ENV.BASE}/api/exam/state`);
  if (!check(state, { 'state loaded': (r) => r.status === 200 })) return;
  const st = state.json();
  for (const q of st.questions) {
    const answer = q.type === 'essay'
      ? { questionId: q.id, essay: 'Load test response' }
      : { questionId: q.id, optionIds: [q.options[0].id] };
    const saved = http.put(`${__ENV.BASE}/api/exam/answer`, JSON.stringify(answer), H);
    if (!check(saved, { 'answer saved': (r) => r.status === 200 })) return;
    sleep(1 + Math.random() * 4);
  }
  const r = http.post(`${__ENV.BASE}/api/exam/submit`, JSON.stringify({ reason: 'manual' }), H);
  check(r, { submitted: (x) => x.status === 200 });
}
