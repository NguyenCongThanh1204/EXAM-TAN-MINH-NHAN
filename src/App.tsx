import { useCallback, useEffect, useRef, useState } from 'react';
import { remainingMs } from './utils/pure';
import { api, fmt, type ApiError } from './api';

type Opt = { id: string; text: string };
type Q = { id: string; text: string; options: Opt[] };
type Res = { correct: number; incorrect: number; result: 'PASS' | 'FAIL' } | null;
type Info = { title: string; logoUrl: string; openingAt: string; closingAt: string; durationMinutes: number; questionCount: number; invitationRequired: boolean; active: boolean; serverNow: string };
type St = { status: string; serverNow: string; deadlineAt?: string; candidate?: { fullName: string; position: string }; questions?: Q[]; answers?: Record<string, string>; result?: Res };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Shell({ info, children }: { info: Info | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          {info && <img src={info.logoUrl} alt="Logo công ty" className="h-10 w-auto" />}
          <h1 className="text-lg font-semibold">{info?.title ?? 'Bài thi trực tuyến'}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}

function Entry({ info, onStarted }: { info: Info; onStarted: () => void }) {
  const [f, setF] = useState({ fullName: '', email: '', position: '', code: '' });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const offset = useRef(Date.parse(info.serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + offset.current), 500); return () => clearInterval(t); }, []);
  const msToOpen = Date.parse(info.openingAt) - now;
  const waiting = msToOpen > 0;
  const closed = now >= Date.parse(info.closingAt);
  const validate = () => {
    const v: Record<string, string> = {};
    if (f.fullName.trim().length < 2) v.fullName = 'Nhập họ và tên.';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) v.email = 'Nhập địa chỉ email hợp lệ.';
    if (f.position.trim().length < 2) v.position = 'Nhập chức danh.';
    if (info.invitationRequired && !f.code.trim()) v.code = 'Nhập mã mời.';
    return v;
  };
  async function go(e?: React.FormEvent, auto = false) {
    e?.preventDefault();
    if (busy || waiting || closed) return;
    const v = validate();
    setFe(v); setErr('');
    if (Object.keys(v).length) { if (auto) setErr('Đã đến giờ thi. Hãy điền đủ thông tin rồi bấm "Bắt đầu thi".'); return; }
    setBusy(true);
    try { await api('exam/start', { method: 'POST', body: JSON.stringify(f) }); onStarted(); }
    catch (x) { const a = x as ApiError; setErr(a.message); if (a.fields) setFe(Object.fromEntries(Object.entries(a.fields).map(([k, m]) => [k, m[0]]))); }
    finally { setBusy(false); }
  }
  // Khi đếm ngược về 0 thì tự động bắt đầu (nếu thông tin đã điền đủ).
  const goRef = useRef(go);
  goRef.current = go;
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting && info.active) void goRef.current(undefined, true);
    wasWaiting.current = waiting;
  }, [waiting, info.active]);
  const countdown = (() => {
    const s = Math.max(0, Math.ceil(msToOpen / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    const d = Math.floor(s / 86400);
    return `${d > 0 ? d + ' ngày ' : ''}${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  })();
  const field = (k: keyof typeof f, label: string, type = 'text', auto?: string) => (
    <div>
      <label htmlFor={k} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={k} type={type} autoComplete={auto} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
        aria-invalid={!!fe[k]} aria-describedby={fe[k] ? k + '-e' : undefined}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base" />
      {fe[k] && <p id={k + '-e'} className="mt-1 text-sm text-red-700">{fe[k]}</p>}
    </div>
  );
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="rules">
        <h2 id="rules" className="mb-3 text-xl font-semibold">Hướng dẫn làm bài</h2>
        <ul className="space-y-2 text-slate-700">
          <li>Kỳ thi mở từ {fmt(info.openingAt)} đến {fmt(info.closingAt)} (giờ Việt Nam).</li>
          <li>{info.questionCount} câu trắc nghiệm, tối đa {info.durationMinutes} phút kể từ lúc bạn bấm bắt đầu.</li>
          <li>Nếu bắt đầu muộn, hạn nộp bài là giờ đóng kỳ thi.</li>
          <li className="font-medium text-slate-900">Nếu bạn chuyển sang tab hoặc cửa sổ khác, bài thi sẽ được nộp tự động ngay lập tức.</li>
          <li>Khi hết giờ, các câu đã chọn được chấm; câu chưa trả lời tính là sai.</li>
        </ul>
      </section>
      <form onSubmit={go} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {field('fullName', 'Họ và tên', 'text', 'name')}
        {field('email', 'Email', 'email', 'email')}
        {field('position', 'Chức danh / vị trí')}
        {info.invitationRequired && field('code', 'Mã mời')}
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        {waiting && info.active && (
          <p role="status" className="rounded-md bg-amber-50 p-3 text-center text-sm text-amber-900">
            Chưa đến giờ thi. Kỳ thi mở sau <b className="font-mono text-base">{countdown}</b>. Hãy điền sẵn thông tin, bài thi sẽ tự động bắt đầu khi đến giờ.
          </p>
        )}
        {closed && <p role="status" className="text-sm text-red-700">Kỳ thi đã kết thúc.</p>}
        <button disabled={busy || !info.active || waiting || closed} className="w-full rounded-md bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {busy ? 'Đang bắt đầu…' : waiting ? 'Chưa đến giờ thi' : 'Bắt đầu thi'}
        </button>
        {!info.active && <p className="text-sm text-slate-600">Kỳ thi hiện chưa được kích hoạt.</p>}
      </form>
    </div>
  );
}

function Exam({ st, onDone }: { st: St; onDone: (r: Res) => void }) {
  const qs = st.questions!;
  const [ans, setAns] = useState<Record<string, string>>(st.answers ?? {});
  const [i, setI] = useState(0);
  const offset = useRef(new Date(st.serverNow).getTime() - Date.now());
  const deadline = new Date(st.deadlineAt!).getTime();
  const [left, setLeft] = useState(remainingMs(deadline, offset.current, Date.now()));
  const [sync, setSync] = useState<'saved' | 'saving' | 'error'>('saved');
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState('');
  const chain = useRef<Promise<unknown>>(Promise.resolve()); // saves are sent in order
  const sub = useRef(false);

  const submit = useCallback(async (reason: 'manual' | 'tab_switch' | 'deadline') => {
    if (sub.current) return;
    sub.current = true;
    setConfirm(false);
    setMsg(reason === 'tab_switch' ? 'Bạn đã rời tab thi hoặc cửa sổ thi mất focus. Bài đang được nộp tự động…' : 'Đang nộp bài…');
    await chain.current.catch(() => undefined);
    for (let k = 0; k < 4; k++) {
      try {
        const r = await api<St>('exam/submit', { method: 'POST', body: JSON.stringify({ reason }), keepalive: true });
        return onDone(r.result ?? null);
      } catch (e) { if ((e as ApiError).status === 401) break; await sleep(800 * (k + 1)); }
    }
    sub.current = false;
    setMsg('Chưa nộp được bài do lỗi mạng. Bấm "Nộp bài" để thử lại.');
  }, [onDone]);

  useEffect(() => {
    const t = setInterval(() => { const r = remainingMs(deadline, offset.current, Date.now()); setLeft(r); if (r <= 0) void submit('deadline'); }, 500);
    const vis = () => { if (document.visibilityState === 'hidden') void submit('tab_switch'); };
    const blur = () => { if (document.visibilityState === 'visible') void submit('tab_switch'); };
    const blockClipboard = (e: Event) => e.preventDefault();
    const blockShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'x', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', blur);
    document.addEventListener('copy', blockClipboard, true);
    document.addEventListener('cut', blockClipboard, true);
    document.addEventListener('paste', blockClipboard, true);
    document.addEventListener('contextmenu', blockClipboard, true);
    document.addEventListener('selectstart', blockClipboard, true);
    document.addEventListener('dragstart', blockClipboard, true);
    document.addEventListener('keydown', blockShortcuts, true);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('blur', blur);
      document.removeEventListener('copy', blockClipboard, true);
      document.removeEventListener('cut', blockClipboard, true);
      document.removeEventListener('paste', blockClipboard, true);
      document.removeEventListener('contextmenu', blockClipboard, true);
      document.removeEventListener('selectstart', blockClipboard, true);
      document.removeEventListener('dragstart', blockClipboard, true);
      document.removeEventListener('keydown', blockShortcuts, true);
    };
  }, [deadline, submit]);

  function pick(q: Q, o: Opt) {
    if (sub.current) return;
    setAns((a) => ({ ...a, [q.id]: o.id }));
    setSync('saving');
    chain.current = chain.current.then(async () => {
      for (let k = 0; k < 3; k++) {
        try { await api('exam/answer', { method: 'PUT', body: JSON.stringify({ questionId: q.id, optionId: o.id }) }); setSync('saved'); return; }
        catch (e) { if ((e as ApiError).status === 409) { void submit('deadline'); return; } await sleep(700); }
      }
      setSync('error');
    });
  }
  const q = qs[i];
  const done = Object.keys(ans).length;
  const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  return (
    <div className="select-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm"><span className="font-medium">{st.candidate?.fullName}</span> · {st.candidate?.position}</div>
        <div className="flex items-center gap-4">
          <span className={'text-sm ' + (sync === 'error' ? 'text-red-700' : 'text-slate-600')} role="status">
            {sync === 'saved' ? 'Đã lưu' : sync === 'saving' ? 'Đang lưu…' : 'Lỗi lưu, đang thử lại'}
          </span>
          <span className={'text-2xl font-semibold tabular-nums ' + (left < 300000 ? 'text-red-700' : '')} aria-label="Thời gian còn lại">{mm}:{ss}</span>
        </div>
      </div>
      {msg && <p role="alert" className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-amber-900">{msg}</p>}
      <div className="mb-3 h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={done}>
        <div className="h-full bg-teal-700" style={{ width: (done / qs.length) * 100 + '%' }} />
      </div>
      <p className="mb-4 text-sm text-slate-600">Câu {i + 1} / {qs.length} · Đã trả lời {done}</p>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-medium">{q.text}</h2>
          <fieldset className="space-y-2">
            <legend className="sr-only">Chọn một đáp án</legend>
            {q.options.map((o) => (
              <label key={o.id} className={'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-3 ' + (ans[q.id] === o.id ? 'border-teal-700 bg-teal-50' : 'border-slate-300')}>
                <input type="radio" name={q.id} checked={ans[q.id] === o.id} onChange={() => pick(q, o)} className="mt-1" />
                <span>{o.text}</span>
              </label>
            ))}
          </fieldset>
          <div className="mt-5 flex justify-between">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="rounded-md border border-slate-300 px-4 py-2 disabled:opacity-40">Câu trước</button>
            {i < qs.length - 1
              ? <button onClick={() => setI(i + 1)} className="rounded-md bg-slate-800 px-4 py-2 text-white">Câu sau</button>
              : <button onClick={() => setConfirm(true)} className="rounded-md bg-teal-700 px-4 py-2 font-semibold text-white">Nộp bài</button>}
          </div>
        </section>
        <nav aria-label="Danh sách câu hỏi" className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-5 gap-1.5">
            {qs.map((x, n) => (
              <button key={x.id} onClick={() => setI(n)} aria-label={`Câu ${n + 1}${ans[x.id] ? ', đã trả lời' : ', chưa trả lời'}`} aria-current={n === i}
                className={'rounded py-1.5 text-sm ' + (n === i ? 'ring-2 ring-slate-900 ' : '') + (ans[x.id] ? 'bg-teal-700 text-white' : 'bg-slate-100')}>{n + 1}</button>
            ))}
          </div>
          <button onClick={() => setConfirm(true)} className="mt-3 w-full rounded-md bg-teal-700 px-3 py-2 font-semibold text-white">Nộp bài</button>
        </nav>
      </div>
      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="cf" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5">
            <h2 id="cf" className="text-lg font-semibold">Nộp bài?</h2>
            <p className="mt-2 text-slate-700">Bạn đã trả lời {done}/{qs.length} câu. Sau khi nộp không thể sửa.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(false)} className="rounded-md border border-slate-300 px-4 py-2">Tiếp tục làm bài</button>
              <button onClick={() => void submit('manual')} className="rounded-md bg-teal-700 px-4 py-2 font-semibold text-white">Nộp bài</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState<Info | null>(null);
  const [st, setSt] = useState<St | null>(null);
  const [res, setRes] = useState<Res>(null);
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'entry' | 'exam' | 'done' | 'error'>('loading');
  const load = useCallback(async () => {
    try {
      const i = await api<Info>('exam/info'); setInfo(i);
      try {
        const s = await api<St>('exam/state'); setSt(s);
        if (s.status === 'in_progress') setPhase('exam'); else { setRes(s.result ?? null); setPhase('done'); }
      } catch (e) { if ((e as ApiError).status === 401) setPhase('entry'); else throw e; }
    } catch { setPhase('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const returnHome = async () => {
    setResetBusy(true);
    setResetError('');
    try {
      await api('exam/reset', { method: 'POST', body: '{}' });
      setSt(null);
      setRes(null);
      setPhase('entry');
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };
  return (
    <Shell info={info}>
      {phase === 'loading' && <p role="status">Đang tải…</p>}
      {phase === 'error' && <p role="alert" className="text-red-700">Không kết nối được máy chủ. <button className="underline" onClick={() => void load()}>Thử lại</button></p>}
      {phase === 'entry' && info && <Entry info={info} onStarted={() => void load()} />}
      {phase === 'exam' && st && <Exam st={st} onDone={(r) => { setRes(r); setPhase('done'); }} />}
      {phase === 'done' && (
        <section className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h2 className="text-xl font-semibold">Bài thi đã được nộp</h2>
          {res ? (
            <>
              <p className={'mt-4 text-3xl font-bold ' + (res.result === 'PASS' ? 'text-teal-700' : 'text-red-700')}>{res.result === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}</p>
              <p className="mt-2 text-slate-700">Đúng {res.correct} câu · Sai {res.incorrect} câu</p>
            </>
          ) : <p className="mt-3 text-slate-700">Kết quả sẽ được ban tổ chức thông báo.</p>}
          {resetError && <p role="alert" className="mt-4 text-sm text-red-700">{resetError}</p>}
          <button disabled={resetBusy} onClick={() => void returnHome()}
            className="mt-6 rounded-md bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {resetBusy ? 'Đang quay lại…' : 'Quay lại trang chủ'}
          </button>
        </section>
      )}
    </Shell>
  );
}
