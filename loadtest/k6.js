// k6 run -e BASE=https://staging.example.com -e ORIGIN=https://staging.example.com loadtest/k6.js
// Needs loadtest/codes.json (["CODE1", ...], >= 300 unused codes) on a STAGING project, never production.
import http from 'k6/http';
import { check, sleep } from 'k6';
const codes = JSON.parse(open('./codes.json'));
export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus: 300, iterations: 1, maxDuration: '15m' } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800', 'p(99)<2000'] },
};
const H = { headers: { 'Content-Type': 'application/json', Origin: __ENV.ORIGIN } };
export default function () {
  sleep(Math.random() * 20); // arrival burst
  const s = http.post(`${__ENV.BASE}/api/exam/start`, JSON.stringify({ fullName: `Load ${__VU}`, email: `load${__VU}@example.com`, position: 'Tester', code: codes[__VU - 1] }), H);
  if (!check(s, { started: (r) => r.status === 201 })) return;
  const st = http.get(`${__ENV.BASE}/api/exam/state`).json();
  for (const q of st.questions) {
    http.put(`${__ENV.BASE}/api/exam/answer`, JSON.stringify({ questionId: q.id, optionId: q.options[0].id }), H);
    sleep(1 + Math.random() * 4);
  }
  const r = http.post(`${__ENV.BASE}/api/exam/submit`, JSON.stringify({ reason: 'manual' }), H);
  check(r, { submitted: (x) => x.status === 200 });
}
