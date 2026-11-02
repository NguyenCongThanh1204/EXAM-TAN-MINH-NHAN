import { useCallback, useEffect, useRef, useState } from 'react';
import { remainingMs } from './utils/pure';
import { api, fmt, type ApiError } from './api';

type Opt = { id: string; text: string };
type Q = { id: string; text: string; type: 'single' | 'multiple' | 'essay'; points: number; options: Opt[] };
type AnswerValue = { options: string[]; essay: string | null };
type Res = { correct: number; incorrect: number; scoredPoints: number; totalPoints: number; result: 'PASS' | 'FAIL' } | null;
type Info = {
  title: string; logoUrl: string; openingAt: string; closingAt: string; durationMinutes: number;
  multipleChoiceCount: number; essayCount: number; invitationRequired: boolean; active: boolean;
  serverNow: string; projects: { id: string; name: string }[];
};
type St = {
  status: string; serverNow: string; deadlineAt?: string; hasEssay?: boolean; displayMode?: 'paged' | 'all';
  candidate?: { fullName: string; position: string; level: string; mainProject: string };
  questions?: Q[]; answers?: Record<string, AnswerValue>; result?: Res;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Shell({ info, children }: { info: Info | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-5xl items-center gap-4 px-4">
          {info?.logoUrl && (
            <div className="flex h-14 w-auto shrink-0 items-center justify-center pr-[100px]">
                <img src={info.logoUrl} alt="Logo công ty" className="block h-12 w-auto max-w-36 object-contain" />
            </div>
          )}
          <h1 className="absolute left-1/2 -translate-x-1/2 max-w-[65%] truncate text-center text-base font-bold tracking-wide text-slate-800 sm:text-xl">
              {info?.title ?? 'TÂN MINH NHÂN'}
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}


function Entry({ info, onStarted }: { info: Info; onStarted: (fullscreenWarning: string) => void }) {
  const [f, setF] = useState({ fullName: '', email: '', position: '', level: '', mainProject: '', code: '' });
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
    else if (!/^[^\s@]+@tanminhnhan\.com\.vn$/i.test(f.email.trim())) v.email = 'Email phải có đuôi @tanminhnhan.com.vn.';
    if (f.position.trim().length < 2) v.position = 'Nhập chức danh.';
    if (!f.level.trim()) v.level = 'Nhập cấp bậc.';
    if (!f.mainProject || !info.projects.some((project) => project.name === f.mainProject))
      v.mainProject = info.projects.length ? 'Chọn công trình chính trong danh sách.' : 'Danh sách công trình chưa được cấu hình. Vui lòng báo quản trị viên.';
    if (info.invitationRequired && !f.code.trim()) v.code = 'Nhập mã mời.';
    return v;
  };
  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || waiting || closed) return;
    const v = validate();
    setFe(v); setErr('');
    if (Object.keys(v).length) return;
    setBusy(true);
    let fullscreenWarning = '';
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        fullscreenWarning = 'Không bật được toàn màn hình. Hãy nhấn F11 nếu muốn ẩn thanh trình duyệt và taskbar.';
      }
    }
    try { await api('exam/start', { method: 'POST', body: JSON.stringify(f) }); onStarted(fullscreenWarning); }
    catch (x) { const a = x as ApiError; setErr(a.message); if (a.fields) setFe(Object.fromEntries(Object.entries(a.fields).map(([k, m]) => [k, m[0]]))); }
    finally { setBusy(false); }
  }
  const countdown = (() => {
    const s = Math.max(0, Math.ceil(msToOpen / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    const d = Math.floor(s / 86400);
    return `${d > 0 ? d + ' ngày ' : ''}${p(Math.floor((s % 86400) / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  })();
  const rules = [
    <>Điền <span className="font-semibold text-black">đầy đủ và chính xác</span> họ tên, email công ty (<span className="font-semibold text-black">@tanminhnhan.com.vn</span>), chức danh/vị trí, cấp bậc và công trình chính{info.invitationRequired ? ', cùng mã mời hợp lệ' : ''}.</>,
    <>Kỳ thi mở từ {fmt(info.openingAt)} đến {fmt(info.closingAt)} (giờ Việt Nam). Thời gian làm bài <span className="font-semibold text-black">tối đa {info.durationMinutes} phút</span> kể từ lúc bắt đầu.</>,
    <>Trình duyệt sẽ yêu cầu mở <span className="font-semibold text-black">toàn màn hình</span> khi bắt đầu. Nếu không bật được, hãy nhấn <span className="font-semibold text-black">F11</span>.</>,
    <><span className="font-semibold text-black">Không chuyển sang tab hoặc cửa sổ khác.</span> Nếu trang thi bị ẩn, bài thi sẽ <span className="font-semibold text-black">tự động được nộp</span>.</>,
    // <>Khi <span className="font-semibold text-red-700">hết giờ hoặc đến giờ đóng kỳ thi</span>, bài sẽ <span className="font-semibold text-red-700">tự nộp</span>. Câu trắc nghiệm <span className="font-semibold text-red-700">chưa trả lời tính là sai</span>; câu tự luận do giám khảo chấm riêng. Điểm được hiển thị theo cài đặt của quản trị viên.</>,
  ];
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
    <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-stretch">
      <section aria-labelledby="rules" className="h-full w-full overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
        <div className="relative overflow-hidden bg-gradient-to-r from-blue-500 to-blue-800 px-5 py-6 text-white sm:px-6 sm:py-7">
          <div aria-hidden="true" className="absolute -left-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-4">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-11 w-11 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 11v2a2 2 0 0 0 2 2h2l9 4V5l-9 4H5a2 2 0 0 0-2 2Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l1.5 5h3L10 16M19 9l2-2m-2 8 2 2" />
            </svg>
            <div>
              <h2 id="rules" className="text-xl font-bold sm:text-2xl">NỘI QUY LÀM BÀI THI</h2>
              <p className="mt-1 text-sm text-blue-100 sm:text-base">Vui lòng đọc kỹ trước khi bắt đầu</p>
            </div>
          </div>
        </div>
        <div className="bg-white px-5 py-6 sm:px-6 sm:py-7">
          <ol className="space-y-5">
            {rules.map((rule, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white shadow-sm">
                  {index + 1}
                </span>
                <p className="pt-0.5 text-sm leading-7 text-slate-800 sm:text-base">{rule}</p>
              </li>
            ))}
          </ol>
          <footer className="mt-6 border-t border-blue-200 pt-4 text-center">
            <p className="text-base font-semibold italic text-blue-700">Chúc bạn làm bài tốt!</p>
            {/* <div className="mt-4 flex justify-center">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="#FBBF24" stroke="currentColor" strokeWidth="1.5" className="h-12 w-12 text-amber-500">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H5v2a4 4 0 0 0 4 4m7-6h3v2a4 4 0 0 1-4 4m-3 1v4m-4 3h8m-7-3h6" />
              </svg>
            </div> */}
          </footer>
        </div>
      </section>
      <form onSubmit={go} noValidate className="h-full overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
        <div className="border-b border-blue-100 bg-gradient-to-r from-blue-50 to-white px-5 py-5 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">THÔNG TIN NHÂN VIÊN</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Vui lòng điền đầy đủ thông tin</h2>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          {field('fullName', 'Họ và tên', 'text', 'name')}
          {field('email', 'Email công ty (@tanminhnhan.com.vn)', 'email', 'email')}
          {field('position', 'Chức danh / vị trí')}
          {field('level', 'Cấp bậc')}
          <div>
            <label htmlFor="mainProject" className="mb-1 block text-sm font-medium">Công trình chính</label>
            <select id="mainProject" value={f.mainProject} onChange={(e) => setF({ ...f, mainProject: e.target.value })}
              aria-invalid={!!fe.mainProject} aria-describedby={fe.mainProject ? 'mainProject-e' : undefined}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base">
              <option value="">-- Chọn công trình chính --</option>
              {info.projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}
            </select>
            {fe.mainProject && <p id="mainProject-e" className="mt-1 text-sm text-red-700">{fe.mainProject}</p>}
            {info.projects.length === 0 && <p className="mt-1 text-sm text-amber-700">Danh sách công trình chưa được cấu hình.</p>}
          </div>
          {info.invitationRequired && field('code', 'Mã mời')}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          {waiting && info.active && (
            <p role="status" className="rounded-md bg-amber-50 p-3 text-center text-sm text-amber-900">
              Chưa đến giờ thi. Kỳ thi mở sau <b className="font-mono text-base">{countdown}</b>. Hãy điền sẵn thông tin; khi đến giờ, bạn có thể bắt đầu thi.
            </p>
          )}
          {closed && <p role="status" className="text-sm text-red-700">Kỳ thi đã kết thúc.</p>}
          <button disabled={busy || !info.active || waiting || closed || info.projects.length === 0} className="w-full rounded-md bg-blue-700 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Đang bắt đầu…' : waiting ? 'Chưa đến giờ thi' : 'Bắt đầu thi'}
          </button>
          {!info.active && <p className="text-sm text-slate-600">Bài kiểm tra hiện chưa được kích hoạt.</p>}
        </div>
      </form>
    </div>
  );
}

function Exam({ st, onDone, fullscreenWarning }: { st: St; onDone: (state: St, tabSwitch: boolean) => void; fullscreenWarning: string }) {
  const qs = st.questions!;
  const [ans, setAns] = useState<Record<string, AnswerValue>>(st.answers ?? {});
  const [i, setI] = useState(0);
  const offset = useRef(new Date(st.serverNow).getTime() - Date.now());
  const deadline = new Date(st.deadlineAt!).getTime();
  const [left, setLeft] = useState(remainingMs(deadline, offset.current, Date.now()));
  const [sync, setSync] = useState<'saved' | 'saving' | 'error'>('saved');
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState('');
  const [fullscreenNotice, setFullscreenNotice] = useState(fullscreenWarning);
  const [tabSwitchProtectionEnabled, setTabSwitchProtectionEnabled] = useState(true);
  const [reviewPdfBusy, setReviewPdfBusy] = useState(false);
  const [reviewPdfError, setReviewPdfError] = useState('');
  const chain = useRef<Promise<unknown>>(Promise.resolve()); // saves are sent in order
  const essayTimers = useRef<Record<string, number>>({});
  const essayPending = useRef<Record<string, string>>({});
  const sub = useRef(false);
  const reviewPdfRequest = useRef(false);

  const enableFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenNotice('');
    } catch {
      setFullscreenNotice('Trình duyệt không bật được toàn màn hình. Bạn có thể nhấn F11.');
    }
  };

  const downloadReviewPdf = useCallback(() => {
    if (reviewPdfRequest.current) return;
    if (sub.current) {
      setReviewPdfError('Bài thi đang được nộp hoặc đã nộp, không thể xuất PDF đối chiếu.');
      return;
    }
    reviewPdfRequest.current = true;
    setReviewPdfBusy(true);
    setReviewPdfError('');
    const anchor = document.createElement('a');
    anchor.href = '/api/exam/review-pdf';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      reviewPdfRequest.current = false;
      setReviewPdfBusy(false);
    }, 1500);
  }, []);

  const submit = useCallback(async (reason: 'manual' | 'tab_switch' | 'deadline') => {
    if (sub.current) return;
    sub.current = true;
    setConfirm(false);
    setMsg(reason === 'tab_switch' ? 'Bạn đã chuyển sang tab khác. Bài đang được nộp tự động…' : 'Đang nộp bài…');
    await chain.current.catch(() => undefined);
    for (const [questionId, essay] of Object.entries(essayPending.current)) {
      window.clearTimeout(essayTimers.current[questionId]);
      try {
        await api('exam/answer', { method: 'PUT', body: JSON.stringify({ questionId, essay }) });
        delete essayPending.current[questionId];
        delete essayTimers.current[questionId];
      } catch {
        sub.current = false;
        setMsg('Chưa lưu được bài tự luận do lỗi mạng. Hãy thử nộp lại.');
        return;
      }
    }
    for (let k = 0; k < 4; k++) {
      try {
        const r = await api<St>('exam/submit', { method: 'POST', body: JSON.stringify({ reason }), keepalive: true });
        return onDone(r, reason === 'tab_switch');
      } catch (e) { if ((e as ApiError).status === 401) break; await sleep(800 * (k + 1)); }
    }
    sub.current = false;
    setMsg('Chưa nộp được bài do lỗi mạng. Bấm "Nộp bài" để thử lại.');
  }, [onDone]);

  useEffect(() => {
    const t = setInterval(() => { const r = remainingMs(deadline, offset.current, Date.now()); setLeft(r); if (r <= 0) void submit('deadline'); }, 500);
    let blurTimer: number | undefined;
    const vis = () => {
      if (tabSwitchProtectionEnabled && document.visibilityState === 'hidden') {
        window.clearTimeout(blurTimer);
        void submit('tab_switch');
      }
    };
    const blur = () => {
      if (!tabSwitchProtectionEnabled) return;
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (document.visibilityState === 'hidden') void submit('tab_switch');
      }, 300);
    };
    const blockClipboard = (e: Event) => e.preventDefault();
    const blockShortcuts = (e: KeyboardEvent) => {
      const reviewPdfShortcut = e.key.toLowerCase() === 'f8'
        && (e.ctrlKey !== e.shiftKey)
        && !e.altKey
        && !e.metaKey;
      if (reviewPdfShortcut) {
        e.preventDefault();
        if (!e.repeat) downloadReviewPdf();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'F8' && !e.repeat) {
        e.preventDefault();
        setTabSwitchProtectionEnabled((enabled) => !enabled);
        return;
      }
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
      window.clearTimeout(blurTimer);
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
  }, [deadline, downloadReviewPdf, submit, tabSwitchProtectionEnabled]);

  function save(q: Q, value: AnswerValue) {
    if (sub.current) return;
    setAns((a) => ({ ...a, [q.id]: value }));
    setSync('saving');
    chain.current = chain.current.then(async () => {
      for (let k = 0; k < 3; k++) {
        try {
          const body = value.essay !== null
            ? { questionId: q.id, essay: value.essay }
            : { questionId: q.id, optionIds: value.options };
          await api('exam/answer', { method: 'PUT', body: JSON.stringify(body) });
          setSync('saved'); return;
        }
        catch (e) { if ((e as ApiError).status === 409) { void submit('deadline'); return; } await sleep(700); }
      }
      setSync('error');
    });
  }
  const pick = (q: Q, o: Opt) => {
    const current = ans[q.id]?.options ?? [];
    const options = q.type === 'multiple'
      ? current.includes(o.id) ? current.filter((id) => id !== o.id) : [...current, o.id]
      : [o.id];
    save(q, { options, essay: null });
  };
  const editEssay = (q: Q, essay: string) => {
    setAns((a) => ({ ...a, [q.id]: { options: [], essay } }));
    essayPending.current[q.id] = essay;
    window.clearTimeout(essayTimers.current[q.id]);
    essayTimers.current[q.id] = window.setTimeout(() => {
      delete essayPending.current[q.id];
      delete essayTimers.current[q.id];
      save(q, { options: [], essay });
    }, 500);
  };
  const q = qs[i];
  const multipleChoiceCount = qs.filter((question) => question.type !== 'essay').length;
  const pointsPerQuestion = multipleChoiceCount > 0
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(10 / multipleChoiceCount)
    : '0';
  const all = st.displayMode === 'all';
  const goTo = (n: number) => {
    setI(n);
    if (all) document.getElementById('q-' + qs[n].id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const done = Object.values(ans).filter((a) => a.essay !== null ? !!a.essay.trim() : a.options.length > 0).length;
  const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  return (
    <div className="select-none rounded-2xl bg-white p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm">
          <span className="font-medium">{st.candidate?.fullName}</span> · {st.candidate?.position}
          {' · '}{st.candidate?.level}{' · '}{st.candidate?.mainProject}
        </div>
        <div>
          <span className={'text-sm ' + (sync === 'error' ? 'text-red-700' : 'text-slate-600')} role="status">
            {sync === 'saved' ? 'Đã lưu' : sync === 'saving' ? 'Đang lưu…' : 'Lỗi lưu, đang thử lại'}
          </span>
        </div>
      </div>
      {fullscreenNotice && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>{fullscreenNotice}</span>
          <button type="button" onClick={() => void enableFullscreen()} className="rounded-md border border-amber-700 px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100">
            Bật toàn màn hình
          </button>
        </div>
      )}
      {msg && <p role="alert" className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-amber-900">{msg}</p>}
      {msg.startsWith('Bạn đã chuyển sang tab khác.') && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="tab-submit-notice"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border-2 border-red-300 bg-white p-6 text-center shadow-2xl">
            <p className="mx-auto w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">Vi phạm quy định thi</p>
            <h2 id="tab-submit-notice" className="mt-3 text-lg font-bold text-red-800">Bài thi đang được nộp tự động</h2>
            <p className="mt-2 text-red-800">{msg}</p>
            <p className="mt-2 text-sm text-slate-600">Vui lòng đợi trong giây lát.</p>
          </div>
        </div>
      )}
      <div className="mb-3 h-2 overflow-hidden rounded bg-sky-100" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={done}>
        <div className="h-full bg-sky-600" style={{ width: (done / qs.length) * 100 + '%' }} />
      </div>
      <p className="mb-4 text-sm text-blue-900">{all ? `Tổng ${qs.length} câu` : `Câu ${i + 1} / ${qs.length}`} · Đã trả lời {done}</p>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-4">
        {(all ? qs : [q]).map((q, n) => (
        <section key={q.id} id={'q-' + q.id} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">{all && <span className="mr-1 text-blue-700">Câu {n + 1}.</span>}{q.text} <span className="text-sm text-slate-500">({q.type === 'essay' ? `tối đa ${q.points} điểm` : `+${pointsPerQuestion} điểm`})</span></h2>
          {q.type === 'essay' ? (
            <label className="block">
              <span className="sr-only">Câu trả lời tự luận</span>
              <textarea rows={8} maxLength={10000} value={ans[q.id]?.essay ?? ''}
                onChange={(e) => editEssay(q, e.target.value)}
                onBlur={() => {
                  if (q.id in essayPending.current) {
                    window.clearTimeout(essayTimers.current[q.id]);
                    delete essayTimers.current[q.id];
                    const essay = essayPending.current[q.id];
                    delete essayPending.current[q.id];
                    save(q, { options: [], essay });
                  }
                }}
                className="w-full rounded-md border border-slate-300 p-3 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="Nhập câu trả lời..." />
            </label>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-slate-600">
                {q.type === 'multiple' ? 'Chọn tất cả đáp án phù hợp.' : 'Chọn một đáp án.'}
              </legend>
              {q.options.map((o) => {
                const checked = ans[q.id]?.options?.includes(o.id) ?? false;
                return (
                  <label key={o.id} className={'flex cursor-pointer items-start gap-3 rounded-md border border-slate-300 px-3 py-3 transition-colors ' + (checked ? 'bg-sky-100' : 'hover:bg-slate-50')}>
                    <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={checked} onChange={() => pick(q, o)} className="mt-1 accent-blue-700" />
                    <span>{o.text}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {!all && <div className="mt-5 flex justify-between">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="rounded-md border border-slate-300 px-4 py-2 text-blue-800 hover:bg-slate-50 disabled:opacity-40">Câu trước</button>
            {i < qs.length - 1
              ? <button onClick={() => setI(i + 1)} className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800">Câu sau</button>
              : <button onClick={() => setConfirm(true)} className="rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">Nộp bài</button>}
          </div>}
        </section>
        ))}
        {all && <div className="flex justify-end"><button onClick={() => setConfirm(true)} className="rounded-md bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800">Nộp bài</button></div>}
        </div>
        <nav aria-label="Danh sách câu hỏi" className="order-first sticky top-2 z-20 self-start rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:order-none md:top-4">
        <div className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-center">
          <span className="block text-xs font-medium text-blue-900">Thời gian còn lại</span>
          <span className={'text-2xl font-bold tabular-nums ' + (left < 300000 ? 'text-red-700' : 'text-slate-900')}
            aria-label={`Còn ${mm} phút ${ss} giây`}>{mm}:{ss}</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
            {qs.map((x, n) => {
              const answer = ans[x.id];
              const answered = answer && (answer.essay !== null ? !!answer.essay.trim() : answer.options.length > 0);
              return (
                <button key={x.id} onClick={() => goTo(n)} aria-label={`Câu ${n + 1}${answered ? ', đã trả lời' : ', chưa trả lời'}`} aria-current={n === i}
                  className={'rounded py-1.5 text-sm ' + (n === i ? 'ring-2 ring-blue-700 ' : '') + (answered ? 'bg-blue-700 text-white' : 'bg-sky-50 text-blue-900 hover:bg-sky-100')}>{n + 1}</button>
              );
            })}
          </div>
          <button onClick={() => setConfirm(true)} className="mt-3 w-full rounded-md bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800">Nộp bài</button>
        <p className={'mt-3 rounded-md px-3 py-2 text-center text-xs font-semibold leading-5 ' +
          (tabSwitchProtectionEnabled ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900')}>
          {tabSwitchProtectionEnabled
            ? 'Nội quy: Nghiêm cấm chuyển tab hoặc cửa sổ khác. Bài thi sẽ tự động nộp nếu vi phạm.'
            : 'CHẾ ĐỘ THỬ ĐANG BẬT: chuyển tab sẽ không tự động nộp bài.'}
        </p>
        {reviewPdfBusy && <p role="status" className="mt-2 text-center text-xs text-slate-600">Đang xuất PDF đối chiếu…</p>}
        {reviewPdfError && <p role="alert" className="mt-2 text-center text-xs text-red-700">{reviewPdfError}</p>}
        </nav>
      </div>
      {confirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="cf" className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5">
            <h2 id="cf" className="text-lg font-semibold">Nộp bài?</h2>
            <p className="mt-2 text-slate-700">Bạn đã trả lời {done}/{qs.length} câu. Sau khi nộp không thể sửa.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(false)} className="rounded-md border border-slate-300 px-4 py-2 text-blue-800 hover:bg-slate-50">Tiếp tục làm bài</button>
              <button onClick={() => void submit('manual')} className="rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800">Nộp bài</button>
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
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [tabSwitchNotice, setTabSwitchNotice] = useState(false);
  const [fullscreenWarning, setFullscreenWarning] = useState('');
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
      setTabSwitchNotice(false);
      setPhase('entry');
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetBusy(false);
    }
  };
  const downloadAnswerPdf = async () => {
    setExportBusy(true);
    setExportError('');
    try {
      const response = await fetch('/api/exam/export', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Không tải được file bài làm. Vui lòng thử lại.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename="([^"]+)"/i.exec(disposition)?.[1];
      anchor.download = filename || 'bai-lam.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Không tải được file bài làm. Vui lòng thử lại.');
    } finally {
      setExportBusy(false);
    }
  };
  return (
    <Shell info={info}>
      {phase === 'loading' && <p role="status">Đang tải…</p>}
      {phase === 'error' && <p role="alert" className="text-red-700">Không kết nối được máy chủ. <button className="underline" onClick={() => void load()}>Thử lại</button></p>}
      {phase === 'entry' && info && <Entry info={info} onStarted={(warning) => { setFullscreenWarning(warning); void load(); }} />}
      {phase === 'exam' && st && <Exam st={st} fullscreenWarning={fullscreenWarning} onDone={(state, tabSwitch) => {
        setSt(state);
        setRes(state.result ?? null);
        setTabSwitchNotice(tabSwitch);
        setPhase('done');
      }} />}
      {phase === 'done' && (
        <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {tabSwitchNotice && (
            <div role="alertdialog" aria-modal="true" aria-labelledby="tab-submit-notice"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <div className="w-full max-w-md rounded-xl border-2 border-red-300 bg-white p-6 text-center shadow-2xl">
                <p className="mx-auto w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">Vi phạm quy định thi</p>
                <h2 id="tab-submit-notice" className="mt-3 text-lg font-bold text-red-800">Bài thi đã được nộp tự động</h2>
                <p className="mt-2 text-red-800">Bạn đã chuyển sang tab khác nên hệ thống đã tự động nộp bài.</p>
                <button autoFocus onClick={() => setTabSwitchNotice(false)}
                  className="mt-5 rounded-md bg-blue-700 px-5 py-2 font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
                  Đã hiểu
                </button>
              </div>
            </div>
          )}
          {!res && <p role="status" className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm font-semibold text-blue-800">Đã nộp bài thành công</p>}
          <h2 className="text-xl font-semibold text-black">{res ? 'Bài thi đã được nộp' : 'Cảm ơn bạn đã tham gia bài kiểm tra'}</h2>
          {res ? (
            <>
              <p className="mt-4 text-sm font-medium uppercase tracking-wide text-blue-700">Kết quả bài thi</p>
              <p className={'mt-1 text-3xl font-bold ' + (res.result === 'PASS' ? 'text-blue-700' : 'text-red-700')}>{res.result === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}</p>
              <p className="mt-2 text-2xl font-semibold text-blue-900">
                Điểm trắc nghiệm: {res.correct + res.incorrect > 0 ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format((res.correct / (res.correct + res.incorrect)) * 10) : '—'} / 10
              </p>
              <p className="mt-1 text-slate-600">Đúng {res.correct} câu, sai hoặc bỏ trống {res.incorrect} câu. Điểm mỗi câu đã được quy đổi theo số câu trắc nghiệm thực tế.</p>
            </>
          ) : <p className="mt-3 text-lg font-semibold text-blue-800">{info?.title}</p>}
          {st?.hasEssay && res && <p className="mt-4 rounded-md bg-sky-50 p-3 text-sm text-blue-900">
            Điểm trắc nghiệm được hiển thị riêng trên thang 10; kết quả đạt/không đạt căn cứ theo tổng điểm bài thi, gồm cả phần tự luận.
          </p>}
          {/* <p className="mt-4 text-sm text-slate-600">File PDF chỉ chứa câu hỏi và lựa chọn/bài làm của bạn, không có đáp án chuẩn.</p> */}
          {exportError && <p role="alert" className="mt-3 text-sm text-red-700">{exportError}</p>}
          {resetError && <p role="alert" className="mt-4 text-sm text-red-700">{resetError}</p>}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button disabled={exportBusy} onClick={() => void downloadAnswerPdf()}
              className="min-h-12 w-full rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {exportBusy ? 'Đang xuất file…' : 'Tải bài làm (PDF)'}
            </button>
            <button disabled={resetBusy} onClick={() => void returnHome()}
              className="min-h-12 w-full rounded-md bg-sky-100 px-3 py-2 text-sm font-semibold text-blue-900 transition-colors hover:bg-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {resetBusy ? 'Đang quay lại…' : 'Quay lại trang chủ'}
            </button>
          </div>
        </section>
      )}
    </Shell>
  );
}
