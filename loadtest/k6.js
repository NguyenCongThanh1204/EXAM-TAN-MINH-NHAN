// Run against STAGING only. Use one shared invitation code with at least VUS unused uses,
// provide loadtest/codes.json with one unused code per VU, or set CODE_REQUIRED=false.
import http from 'k6/http';
import { check, sleep } from 'k6';
const vus = Number(__ENV.VUS || 300);
const jitterSeconds = Number(__ENV.JITTER_SECONDS || 20);
const codeRequired = __ENV.CODE_REQUIRED !== 'false';
const codes = __ENV.CODE || !codeRequired ? null : JSON.parse(open('./codes.json'));
if (!Number.isInteger(vus) || vus < 1) throw new Error('VUS must be a positive integer');
if (!Number.isFinite(jitterSeconds) || jitterSeconds < 0) throw new Error('JITTER_SECONDS must be zero or greater');
if (codes && codes.length < vus) throw new Error(`codes.json must contain at least ${vus} unused codes`);
export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus, iterations: 1, maxDuration: '15m' } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<800', 'p(99)<2000'] },
};
const H = { headers: { 'Content-Type': 'application/json', Origin: __ENV.ORIGIN } };
export default function () {
  sleep(Math.random() * jitterSeconds); // spread arrivals across the selected burst window
  const code = __ENV.CODE || (codes ? codes[__VU - 1] : undefined);
  const candidate = {
    fullName: `Load ${__VU}`, email: `load${__VU}@example.com`, position: 'Tester',
    level: 'Load test', mainProject: 'Staging',
  };
  if (code) candidate.code = code;
  const s = http.post(`${__ENV.BASE}/api/exam/start`, JSON.stringify(candidate), H);
  if (!check(s, { started: (r) => r.status === 201 })) return;
  const st = http.get(`${__ENV.BASE}/api/exam/state`).json();
  for (const q of st.questions) {
    http.put(`${__ENV.BASE}/api/exam/answer`, JSON.stringify({ questionId: q.id, optionId: q.options[0].id }), H);
    sleep(1 + Math.random() * 4);
  }
  const r = http.post(`${__ENV.BASE}/api/exam/submit`, JSON.stringify({ reason: 'manual' }), H);
  check(r, { submitted: (x) => x.status === 200 });
}
