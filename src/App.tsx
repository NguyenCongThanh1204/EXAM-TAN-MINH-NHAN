import { useCallback, useEffect, useRef, useState } from 'react';
import { remainingMs } from './utils/pure';
import { api, fmt, type ApiError } from './api';

type Opt = { id: string; text: string };
type Q = { id: string; text: string; type: 'single' | 'multiple' | 'essay'; options: Opt[] };
type AnswerValue = { options: string[]; essay: string | null };
type Res = { correct: number; incorrect: number; scoredPoints: number; totalPoints: number; result: 'PASS' | 'FAIL' } | null;
type Info = {
  title: string; logoUrl: string; openingAt: string; closingAt: string; durationMinutes: number;
  multipleChoiceCount: number; essayCount: number; active: boolean;
  serverNow: string; projects: { id: string; name: string }[];
};
type St = {
  status: string; serverNow: string; attemptId?: string; deadlineAt?: string; hasEssay?: boolean; pendingGrade?: boolean;
  displayMode?: 'paged' | 'all';
  candidate?: { fullName: string; position: string; level: string; mainProject: string };
  questions?: Q[]; answers?: Record<string, AnswerValue>; result?: Res;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type FlushResult = 'saved' | 'error' | 'expired';

function isValidOptionIds(value: unknown, question: Q): value is string[] {
  return Array.isArray(value) && value.length <= 6
    && value.every((id: unknown) => typeof id === 'string' && question.options.some((option) => option.id === id));
}

function readAnswerDraft(attemptId: string | undefined, questions: Q[]) {
  const pending: Record<string, AnswerValue> = {};
  if (!attemptId) return { pending, warning: '' };
  try {
    const raw = window.localStorage.getItem(`exam-answer-draft:${attemptId}`);
    if (!raw) return { pending, warning: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { pending, warning: 'Bản nháp trên thiết bị không hợp lệ; các câu trả lời đã lưu trên máy chủ vẫn được giữ.' };
    }

    let invalidEntries = false;
    for (const [questionId, value] of Object.entries(parsed)) {
      const question = questions.find((item) => item.id === questionId);
      if (!question || !value || typeof value !== 'object' || Array.isArray(value)) {
        invalidEntries = true;
        continue;
      }
      const answer = value as Record<string, unknown>;
      if (!isValidOptionIds(answer.options, question)) {
        invalidEntries = true;
        continue;
      }
      if (question.type === 'essay') {
        if (answer.options.length !== 0 || typeof answer.essay !== 'string' || answer.essay.length > 10000) {
          invalidEntries = true;
          continue;
        }
        pending[questionId] = { options: [], essay: answer.essay };
      } else {
        if (answer.essay !== null || (question.type === 'single' && answer.options.length !== 1)) {
          invalidEntries = true;
          continue;
        }
        pending[questionId] = { options: answer.options, essay: null };
      }
    }
    return {
      pending,
      warning: invalidEntries ? 'Một số đáp án nháp không hợp lệ đã bị bỏ qua; các câu trả lời đã lưu trên máy chủ vẫn được giữ.' : '',
    };
  } catch (error) {
    console.error('Không thể khôi phục bản nháp đáp án trên thiết bị.', error);
    return { pending, warning: 'Không thể khôi phục bản nháp trên thiết bị; các câu trả lời đã lưu trên máy chủ vẫn được giữ.' };
  }
}

function Shell({ info, children, compact = false }: { info: Info | null; children: React.ReactNode; compact?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-20 max-w-5xl items-center gap-4 px-4">
          {info?.logoUrl && (
            <div className="flex h-14 w-auto shrink-0 items-center justify-center pr-[100px]">
                <img src={info.logoUrl} alt="Logo công ty" className="block h-12 w-auto max-w-36 object-contain" />
            </div>
          )}
          <h1 className="absolute left-1/2 -translate-x-1/2 max-w-[65%] truncate text-center text-lg font-bold tracking-wide text-[#1F2944] sm:text-2xl">
              {info?.title ?? 'TÂN MINH NHÂN'}
          </h1>
        </div>
      </header>
      <main className={'mx-auto max-w-5xl px-4 ' + (compact ? 'py-3' : 'py-6')}>
        {children}
      </main>
    </div>
  );
}


function Entry({ info, onStarted }: { info: Info; onStarted: (fullscreenWarning: string) => void }) {
  const [f, setF] = useState({ fullName: '', email: '', position: '', level: '', mainProject: '' });
  const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
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
    return v;
  };
  async function go(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || waiting || closed) return;
    const v = validate();
    setFe(v); setErr('');
    const acceptanceMessage = rulesAccepted ? '' : 'Vui lòng xác nhận đã đọc và đồng ý tuân thủ nội quy thi.';
    setAcceptanceError(acceptanceMessage);
    if (Object.keys(v).length || acceptanceMessage) return;
    setBusy(true);
    let fullscreenWarning = '';
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        fullscreenWarning = 'Không bật được toàn màn hình. Trong bài thi, hãy dùng nút “Bật toàn màn hình” để thử lại.';
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
    <>Điền <span className="font-semibold text-black">đầy đủ và chính xác</span> họ tên, email công ty (<span className="font-semibold text-black">@tanminhnhan.com.vn</span>) có trong danh sách được duyệt, chức danh/vị trí, cấp bậc và công trình chính.</>,
    <>Kỳ thi mở từ {fmt(info.openingAt)} đến {fmt(info.closingAt)} (giờ Việt Nam).</>,
    <>Trình duyệt sẽ yêu cầu mở <span className="font-semibold text-black">toàn màn hình</span> khi bắt đầu. Nếu không bật được, hãy nhấn <span className="font-semibold text-black">F11</span>.</>,
    <><span className="font-semibold text-red-700">Không chuyển sang tab hoặc cửa sổ khác.</span> Nếu trang thi bị ẩn, bài thi sẽ <span className="font-semibold text-black">tự động được nộp</span>.</>,
    // <>Khi <span className="font-semibold text-red-700">hết giờ hoặc đến giờ đóng kỳ thi</span>, bài sẽ <span className="font-semibold text-red-700">tự nộp</span>. Câu trắc nghiệm <span className="font-semibold text-red-700">chưa trả lời tính là sai</span>; câu tự luận do giám khảo chấm riêng. Điểm được hiển thị theo cài đặt của quản trị viên.</>,
  ];
  const field = (k: keyof typeof f, label: string, type = 'text', auto?: string) => (
    <div>
      <label htmlFor={k} className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className={k === 'email' ? 'flex' : undefined}>
        <input ref={k === 'email' ? emailInputRef : undefined} id={k}
          type={k === 'email' ? 'text' : type} inputMode={k === 'email' ? 'email' : undefined}
          autoComplete={auto} value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
          aria-invalid={!!fe[k]} aria-describedby={fe[k] ? k + '-e' : undefined}
          className={'w-full rounded-lg border border-slate-300 bg-slate-50/70 px-3.5 py-1.5 text-base leading-6 transition-all placeholder:text-slate-400 focus:border-[#294075] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 ' +
            (k === 'email' ? 'rounded-r-none' : '')} />
        {k === 'email' && (
          <button type="button" onClick={() => {
            setF((current) => {
              const localPart = current.email.trim().split('@')[0];
              return { ...current, email: `${localPart}@tanminhnhan.com.vn` };
            });
            requestAnimationFrame(() => {
              const input = emailInputRef.current;
              if (!input) return;
              const cursor = input.value.indexOf('@');
              input.focus();
              input.setSelectionRange(cursor, cursor);
            });
          }}
            className="shrink-0 rounded-r-lg border border-l-0 border-slate-300 bg-slate-100 px-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 focus:z-10 focus:outline-none focus:ring-2 focus:ring-blue-100">
            @tanminhnhan.com.vn
          </button>
        )}
      </div>
      {fe[k] && <p id={k + '-e'} className="mt-1 text-sm text-red-700">{fe[k]}</p>}
    </div>
  );
  const examStatus = closed ? 'Đã kết thúc' : !info.active ? 'Chưa kích hoạt' : waiting ? 'Sắp mở thi' : 'Đang mở thi';
  return (
    <div className="mx-auto max-w-5xl space-y-4 lg:min-h-[calc(100vh-8rem)]">
      {/* <section className="text-center">
        <span className={'mb-3 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold tracking-wide ' +
          (closed || !info.active ? 'border-slate-200 bg-slate-100 text-slate-600' : waiting ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
          <span className={'h-2 w-2 rounded-full ' +
            (closed || !info.active ? 'bg-slate-400' : waiting ? 'bg-amber-500' : 'bg-emerald-500')} />
          {examStatus}
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">CỔNG THI TRỰC TUYẾN</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
          {info.title || 'Vui lòng đọc nội quy và điền đầy đủ thông tin trước khi bắt đầu.'}
        </p>
      </section> */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
      <section aria-labelledby="rules" className="w-full overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm lg:flex lg:flex-col">
        <div className="relative min-h-[5rem] overflow-hidden bg-gradient-to-r from-[#294075] to-[#172554] px-5 py-3 text-white sm:min-h-[5rem] sm:px-6">
          <div aria-hidden="true" className="absolute -left-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-10 w-10 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 11v2a2 2 0 0 0 2 2h2l9 4V5l-9 4H5a2 2 0 0 0-2 2Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 15l1.5 5h3L10 16M19 9l2-2m-2 8 2 2" />
            </svg>
            <div className="text-center">
              <h2 id="rules" className="text-lg font-bold sm:text-xl">NỘI QUY LÀM BÀI THI</h2>
              <p className="mt-0.5 text-xs text-blue-100 sm:text-sm">Vui lòng đọc kỹ trước khi bắt đầu</p>
            </div>
            <div aria-hidden="true" />
          </div>
        </div>
        <div className="bg-white px-4 py-4 sm:px-5 sm:py-4 lg:flex lg:flex-1 lg:flex-col lg:justify-between">
          <ol className="space-y-2">
            {rules.map((rule, index) => (
              <li key={index} className={'flex items-start gap-2 rounded-xl border p-2 transition-colors ' +
                (index === 3 ? 'border-red-200/70 bg-red-50/70' : 'border-transparent hover:border-slate-200/60 hover:bg-slate-50')}>
                <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm ' +
                  (index === 3 ? 'bg-[#D9232E] shadow-red-500/20' : 'bg-[#1B365D] shadow-slate-900/10')}>
                  {index + 1}
                </span>
                <p className={'pt-0.5 text-sm leading-5 ' + (index === 3 ? 'text-red-950' : 'text-slate-700')}>{rule}</p>
              </li>
            ))}
          </ol>
          <div className="mt-3 grid grid-cols-3 gap-2 border-y border-slate-100 py-2 text-center">
            <div className="rounded-lg bg-slate-50 p-2">
              <span className="block text-xs text-slate-500">Số câu hỏi</span>
              <span className="text-sm font-bold text-slate-800">{info.multipleChoiceCount + info.essayCount} câu</span>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <span className="block text-xs text-slate-500">Thời lượng</span>
              <span className="text-sm font-bold text-slate-800">{info.durationMinutes} phút</span>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <span className="block text-xs text-slate-500">Trạng thái</span>
              <span className={'text-xs font-bold sm:text-sm ' +
                (closed || !info.active ? 'text-slate-600' : waiting ? 'text-amber-800' : 'text-emerald-700')}>
                {examStatus}
              </span>
            </div>
          </div>
          <footer className="mt-3 flex items-center justify-center gap-2 border-t border-blue-200 pt-2 text-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="#FBBF24" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6 shrink-0 text-amber-500">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H5v2a4 4 0 0 0 4 4m7-6h3v2a4 4 0 0 1-4 4m-3 1v4m-4 3h8m-7-3h6" />
            </svg>
            <p className="text-sm font-semibold italic text-[#172554]">Chúc bạn làm bài tốt!</p>
          </footer>
        </div>
      </section>
      <form onSubmit={go} noValidate className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
        <div className="flex min-h-[5rem] items-center gap-3 border-b border-blue-900/40 bg-gradient-to-r from-[#294075] to-[#172554] px-5 py-3 text-white sm:min-h-[5rem] sm:px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 shadow-inner">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 text-blue-200">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">THÔNG TIN NGƯỜI DỰ THI</h2>
            <p className="mt-0.5 text-xs text-blue-200/80 sm:text-sm">Vui lòng điền đầy đủ và kiểm tra kỹ thông tin</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-3">
          <div className="space-y-1.5">
            {field('fullName', 'Họ và tên', 'text', 'name')}
            {field('email', 'Email công ty', 'email', 'email')}
            {field('position', 'Chức danh / vị trí')}
            {field('level', 'Cấp bậc')}
            <div>
              <label htmlFor="mainProject" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Địa điểm thi <span className="text-red-500">*</span>
              </label>
              <select id="mainProject" value={f.mainProject} onChange={(e) => setF({ ...f, mainProject: e.target.value })}
                aria-invalid={!!fe.mainProject} aria-describedby={fe.mainProject ? 'mainProject-e' : undefined}
                className="w-full rounded-lg border border-slate-300 bg-slate-50/70 px-3.5 py-1.5 text-base leading-6 transition-all focus:border-[#294075] focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100">
                <option value="">-- Chọn địa điểm thi --</option>
                {info.projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}
              </select>
              {fe.mainProject && <p id="mainProject-e" className="mt-1 text-sm text-red-700">{fe.mainProject}</p>}
              {info.projects.length === 0 && <p className="mt-1 text-sm text-amber-700">Danh sách công trình chưa được cấu hình.</p>}
            </div>
            <div>
              <label htmlFor="rulesAccepted" className={'flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 text-sm leading-5 transition-colors ' +
                (acceptanceError ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-50')}>
                <input id="rulesAccepted" type="checkbox" checked={rulesAccepted}
                  onChange={(e) => {
                    setRulesAccepted(e.target.checked);
                    if (e.target.checked) setAcceptanceError('');
                  }}
                  aria-required="true"
                  aria-invalid={!!acceptanceError}
                  aria-describedby={acceptanceError ? 'rulesAccepted-error' : undefined}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#1B365D] focus:ring-[#1B365D]" />
                <span>Tôi đã đọc, hiểu rõ và cam kết tuân thủ toàn bộ nội quy phòng thi.</span>
              </label>
              {acceptanceError && <p id="rulesAccepted-error" role="alert" className="mt-1 text-sm text-red-700">{acceptanceError}</p>}
              {/* {!rulesAccepted && !acceptanceError && <p className="mt-1 text-xs text-slate-500">Cần xác nhận để bật nút bắt đầu thi.</p>} */}
            </div>
            {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
            {waiting && info.active && (
              <p role="status" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <span className="shrink-0 font-mono text-base font-bold">{countdown}</span>
                <span>Chưa đến giờ thi. Bạn có thể điền sẵn thông tin và bắt đầu khi kỳ thi mở.</span>
              </p>
            )}
            {closed && <p role="status" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Kỳ thi đã kết thúc.</p>}
            {!info.active && <p className="text-sm text-slate-600">Bài kiểm tra hiện chưa được kích hoạt.</p>}
          </div>
          <div className="mt-2 space-y-1.5">
            <button disabled={busy || !info.active || waiting || closed || info.projects.length === 0 || !rulesAccepted}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#1B365D] px-6 py-2.5 text-base font-bold tracking-wide text-white shadow-md shadow-slate-900/10 transition-all hover:bg-[#10223D] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
              <span>{busy ? 'ĐANG BẮT ĐẦU…' : waiting ? 'CHƯA ĐẾN GIỜ THI' : 'BẮT ĐẦU THI'}</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 transition-transform group-hover:translate-x-1">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0-7 7m7-7H3" />
              </svg>
            </button>
            <p className="flex items-center justify-center gap-2 text-center text-[11px] font-medium text-slate-500">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-emerald-600">
                <path fillRule="evenodd" d="M10 1.5 3 4v5c0 4.2 2.8 7.7 7 9.5 4.2-1.8 7-5.3 7-9.5V4l-7-2.5Zm3.2 6.8a.9.9 0 0 0-1.3-1.3L9 9.9 8.1 9a.9.9 0 1 0-1.3 1.3l1.6 1.6a.9.9 0 0 0 1.3 0l3.5-3.6Z" clipRule="evenodd" />
              </svg>
              Hệ thống sẽ tự động nộp bài nếu phát hiện rời khỏi màn hình thi.
            </p>
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}

function Exam({ st, onDone, fullscreenWarning }: { st: St; onDone: (state: St, tabSwitch: boolean) => void; fullscreenWarning: string }) {
  const qs = st.questions!;
  const [restoredDraft] = useState(() => readAnswerDraft(st.attemptId, qs));
  const [ans, setAns] = useState<Record<string, AnswerValue>>(() => ({ ...(st.answers ?? {}), ...restoredDraft.pending }));
  const [i, setI] = useState(0);
  const offset = useRef(new Date(st.serverNow).getTime() - Date.now());
  const deadline = new Date(st.deadlineAt!).getTime();
  const [left, setLeft] = useState(remainingMs(deadline, offset.current, Date.now()));
  const [sync, setSync] = useState<'saved' | 'saving' | 'error'>(Object.keys(restoredDraft.pending).length ? 'saving' : 'saved');
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState('');
  const [draftWarning, setDraftWarning] = useState(restoredDraft.warning);
  const [fullscreenNotice, setFullscreenNotice] = useState(fullscreenWarning);
  const [tabSwitchProtectionEnabled, setTabSwitchProtectionEnabled] = useState(true);
  const [reviewPdfBusy, setReviewPdfBusy] = useState(false);
  const [reviewPdfError, setReviewPdfError] = useState('');
  const pendingAnswers = useRef(new Map(Object.entries(restoredDraft.pending)));
  const batchTimer = useRef<number | null>(null);
  const flushInFlight = useRef<Promise<FlushResult> | null>(null);
  const flushRef = useRef<() => Promise<FlushResult>>(async () => 'saved');
  const submitRef = useRef<(reason: 'manual' | 'tab_switch' | 'deadline') => Promise<void>>(async () => undefined);
  const sub = useRef(false);
  const reviewPdfRequest = useRef(false);
  const draftKey = `exam-answer-draft:${st.attemptId ?? ''}`;

  const persistPendingDraft = useCallback(() => {
    try {
      if (!st.attemptId) throw new Error('Thiếu mã lượt thi để lưu bản nháp.');
      const draft = Object.fromEntries(pendingAnswers.current);
      if (Object.keys(draft).length) window.localStorage.setItem(draftKey, JSON.stringify(draft));
      else window.localStorage.removeItem(draftKey);
      setDraftWarning('');
    } catch (error) {
      console.error('Không thể lưu bản nháp đáp án trên thiết bị.', error);
      setDraftWarning('Không lưu được bản nháp trên thiết bị; hãy giữ trang thi mở cho đến khi trạng thái hiển thị “Đã lưu”.');
    }
  }, [draftKey, st.attemptId]);

  const scheduleFlush = useCallback((delay = 120000) => {
    if (sub.current || !pendingAnswers.current.size || batchTimer.current !== null) return;
    batchTimer.current = window.setTimeout(() => {
      batchTimer.current = null;
      void flushRef.current().then((result) => {
        if (result === 'expired') void submitRef.current('deadline');
      });
    }, delay);
  }, []);

  const flushAnswers = useCallback(async (): Promise<FlushResult> => {
    if (flushInFlight.current) return flushInFlight.current;
    const batch = [...pendingAnswers.current.entries()].slice(0, 5);
    if (!batch.length) return 'saved';
    if (batchTimer.current !== null) {
      window.clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }

    let retryAutomatically = true;
    const request = (async (): Promise<FlushResult> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const answers = batch.map(([questionId, answer]) => answer.essay !== null
            ? { questionId, essay: answer.essay }
            : { questionId, optionIds: answer.options });
          await api('exam/answers', { method: 'PUT', body: JSON.stringify({ answers }) });
          for (const [questionId, answer] of batch) {
            if (pendingAnswers.current.get(questionId) === answer) pendingAnswers.current.delete(questionId);
          }
          persistPendingDraft();
          setSync(pendingAnswers.current.size ? 'saving' : 'saved');
          return 'saved';
        } catch (error) {
          const status = (error as ApiError).status;
          if (status === 409) {
            setSync('error');
            return 'expired';
          }
          if (status && status < 500 && status !== 429) {
            retryAutomatically = false;
            break;
          }
          if (attempt < 2) await sleep(500 * (attempt + 1));
        }
      }
      setSync('error');
      return 'error';
    })();

    flushInFlight.current = request;
    const result = await request;
    if (flushInFlight.current === request) flushInFlight.current = null;
    if (result === 'saved' && pendingAnswers.current.size && !sub.current) {
      if (pendingAnswers.current.size >= 5) {
        void flushRef.current().then((nextResult) => {
          if (nextResult === 'expired') void submitRef.current('deadline');
        });
      } else {
        scheduleFlush();
      }
    } else if (result === 'error' && retryAutomatically && !sub.current) {
      scheduleFlush(5000);
    }
    return result;
  }, [persistPendingDraft, scheduleFlush]);
  flushRef.current = flushAnswers;

  const enableFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenNotice('');
    } catch {
      setFullscreenNotice('Trình duyệt không bật được toàn màn hình. Hãy kiểm tra quyền toàn màn hình hoặc thử lại bằng nút này.');
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
    if (batchTimer.current !== null) {
      window.clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }
    while (pendingAnswers.current.size) {
      const result = await flushAnswers();
      if (result === 'error') {
        sub.current = false;
        setMsg('Chưa đồng bộ được các đáp án do lỗi mạng. Bài chưa được nộp; hãy kiểm tra kết nối rồi thử lại.');
        return;
      }
      if (result === 'expired') break;
    }
    for (let k = 0; k < 4; k++) {
      try {
        const r = await api<St>('exam/submit', { method: 'POST', body: JSON.stringify({ reason }), keepalive: true });
        pendingAnswers.current.clear();
        persistPendingDraft();
        return onDone(r, reason === 'tab_switch');
      } catch (e) { if ((e as ApiError).status === 401) break; await sleep(800 * (k + 1)); }
    }
    sub.current = false;
    setMsg('Chưa nộp được bài do lỗi mạng. Bấm "Nộp bài" để thử lại.');
  }, [flushAnswers, onDone, persistPendingDraft]);
  submitRef.current = submit;

  useEffect(() => {
    const t = setInterval(() => {
      const r = remainingMs(deadline, offset.current, Date.now());
      setLeft(r);
      if (r <= 0) void submit('deadline');
      else if (tabSwitchProtectionEnabled && (document.hidden || !document.hasFocus())) void submit('tab_switch');
    }, 500);
    const vis = () => {
      if (tabSwitchProtectionEnabled && document.visibilityState === 'hidden') void submit('tab_switch');
    };
    const blur = () => {
      if (tabSwitchProtectionEnabled) void submit('tab_switch');
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
      if (tabSwitchProtectionEnabled && document.fullscreenElement && (e.key === 'Escape' || e.key === 'F11')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'x', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    const handleFullscreenChange = () => {
      if (document.fullscreenElement || !tabSwitchProtectionEnabled || sub.current) return;
      setFullscreenNotice('Đang thử khôi phục toàn màn hình…');
      void document.documentElement.requestFullscreen()
        .then(() => setFullscreenNotice(''))
        .catch(() => setFullscreenNotice('Trình duyệt đã thoát toàn màn hình. Hãy nhấn “Bật toàn màn hình” để tiếp tục.'));
    };
    document.addEventListener('visibilitychange', vis);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
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
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

  useEffect(() => {
    if (pendingAnswers.current.size) scheduleFlush();
    const onPageHide = () => {
      if (pendingAnswers.current.size) void flushRef.current();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      if (batchTimer.current !== null) window.clearTimeout(batchTimer.current);
      batchTimer.current = null;
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [scheduleFlush]);

  function queueAnswer(q: Q, value: AnswerValue) {
    if (sub.current) return;
    const next = { options: [...value.options], essay: value.essay };
    setAns((a) => ({ ...a, [q.id]: next }));
    pendingAnswers.current.set(q.id, next);
    persistPendingDraft();
    setSync('saving');
    if (pendingAnswers.current.size >= 5) {
      if (batchTimer.current !== null) {
        window.clearTimeout(batchTimer.current);
        batchTimer.current = null;
      }
      flushPendingAnswers();
    } else {
      scheduleFlush();
    }
  }
  function flushPendingAnswers() {
    void flushRef.current().then((result) => {
      if (result === 'expired') void submitRef.current('deadline');
    });
  }
  const pick = (q: Q, o: Opt) => {
    const current = ans[q.id]?.options ?? [];
    const options = q.type === 'multiple'
      ? current.includes(o.id) ? current.filter((id) => id !== o.id) : [...current, o.id]
      : [o.id];
    queueAnswer(q, { options, essay: null });
  };
  const editEssay = (q: Q, essay: string) => {
    queueAnswer(q, { options: [], essay });
  };
  const q = qs[i];
  const pointsPerQuestion = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(0.5);
  const all = st.displayMode === 'all';
  const goTo = (n: number) => {
    setI(n);
    if (all) document.getElementById('q-' + qs[n].id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const done = Object.values(ans).filter((a) => a.essay !== null ? !!a.essay.trim() : a.options.length > 0).length;
  const mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  return (
    <div className="select-none rounded-2xl bg-white p-3 sm:p-4">
      {tabSwitchProtectionEnabled && !document.fullscreenElement && !sub.current && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="fullscreen-required"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
            <h2 id="fullscreen-required" className="text-lg font-bold text-slate-900">Cần bật toàn màn hình</h2>
            <p className="mt-2 text-sm text-slate-600">
              Không thể tiếp tục làm bài khi đã thoát toàn màn hình. Hãy bật lại để tiếp tục.
            </p>
            <button type="button" onClick={() => void enableFullscreen()}
              className="mt-5 rounded-md bg-[#294075] px-5 py-2 font-semibold text-white transition-colors hover:bg-[#172554] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2">
              Bật lại toàn màn hình
            </button>
          </div>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm">
          <span className="font-medium">{st.candidate?.fullName}</span> · {st.candidate?.position}
          {' · '}{st.candidate?.level}{' · '}{st.candidate?.mainProject}
        </div>
        <div>
          <span className={'text-sm ' + (sync === 'error' ? 'text-red-700' : 'text-slate-600')} role="status">
            {sync === 'saved' ? 'Đã lưu' : sync === 'saving' ? 'Đang lưu…' : 'Lỗi lưu, đáp án đang chờ đồng bộ'}
          </span>
        </div>
      </div>
      {draftWarning && <p role="alert" className="mb-4 rounded-md bg-amber-100 px-4 py-3 text-amber-900">{draftWarning}</p>}
      {fullscreenNotice && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>{fullscreenNotice}</span>
          <button type="button" onClick={() => void enableFullscreen()} className="rounded-md border border-[#36796F] px-3 py-1.5 font-semibold text-[#36796F] hover:bg-[#EDF6F4]">
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
      <div className="mb-3 h-2 overflow-hidden rounded bg-[#EDF6F4]" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={done}>
        <div className="h-full bg-[#0E794E]" style={{ width: (done / qs.length) * 100 + '%' }} />
      </div>
      <p className="mb-4 text-sm text-[#35645F]">{all ? `Tổng ${qs.length} câu` : `Câu ${i + 1} / ${qs.length}`} · Đã trả lời {done}</p>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="min-w-0 space-y-4">
        {(all ? qs : [q]).map((q, n) => (
        <section key={q.id} id={'q-' + q.id} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">{all && <span className="mr-1 text-[#35645F]">Câu {n + 1}.</span>}{q.text} <span className="text-sm text-slate-500">(tối đa {pointsPerQuestion} điểm)</span></h2>
          {q.type === 'essay' ? (
            <label className="block">
              <span className="sr-only">Câu trả lời tự luận</span>
              <textarea rows={8} maxLength={10000} value={ans[q.id]?.essay ?? ''}
                onChange={(e) => editEssay(q, e.target.value)}
                className="w-full rounded-md border border-slate-300 p-3 focus:border-[#299D8F] focus:outline-none focus:ring-2 focus:ring-[#EDF6F4]" placeholder="Nhập câu trả lời..." />
            </label>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-slate-600">
                {q.type === 'multiple' ? 'Chọn tất cả đáp án phù hợp.' : 'Chọn một đáp án.'}
              </legend>
              {q.options.map((o) => {
                const checked = ans[q.id]?.options?.includes(o.id) ?? false;
                return (
                  <label key={o.id} className={'flex cursor-pointer items-start gap-3 rounded-md border border-slate-300 px-3 py-3 transition-colors ' + (checked ? 'bg-[#EDF6F4]' : 'hover:bg-slate-50')}>
                    <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={checked} onChange={() => pick(q, o)} className="mt-1 accent-[#299D8F]" />
                    <span>{o.text}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {!all && <div className="mt-5 flex justify-between">
            <button disabled={i === 0} onClick={() => setI(i - 1)} className="rounded-md border border-slate-300 px-4 py-2 text-[#36796F] hover:bg-[#EDF6F4] disabled:opacity-40">Câu trước</button>
            {i < qs.length - 1
              ? <button onClick={() => setI(i + 1)} className="rounded-md bg-[#36796F] px-4 py-2 text-white hover:bg-[#2F6A61]">Câu sau</button>
              : <button onClick={() => setConfirm(true)} className="rounded-md bg-[#36796F] px-4 py-2 font-semibold text-white hover:bg-[#2F6A61]">Nộp bài</button>}
          </div>}
        </section>
        ))}
        {all && <div className="flex justify-end"><button onClick={() => setConfirm(true)} className="rounded-md bg-[#36796F] px-6 py-3 font-semibold text-white hover:bg-[#2F6A61]">Nộp bài</button></div>}
        </div>
        <nav aria-label="Danh sách câu hỏi" className="order-first sticky top-2 z-20 self-start rounded-lg border border-slate-200 bg-white p-3 shadow-sm md:order-none md:top-4">
        <div className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-center">
          <span className="block text-xs font-medium text-[#1F2944]">Thời gian còn lại</span>
          <span className={'text-2xl font-bold tabular-nums ' + (left < 300000 ? 'text-red-700' : 'text-[#1F2944]')}
            aria-label={`Còn ${mm} phút ${ss} giây`}>{mm}:{ss}</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
            {qs.map((x, n) => {
              const answer = ans[x.id];
              const answered = answer && (answer.essay !== null ? !!answer.essay.trim() : answer.options.length > 0);
              return (
                <button key={x.id} onClick={() => goTo(n)} aria-label={`Câu ${n + 1}${answered ? ', đã trả lời' : ', chưa trả lời'}`} aria-current={n === i}
                  className={'rounded py-1.5 text-sm ' + (n === i ? 'ring-2 ring-[#299D8F] ' : '') + (answered ? 'bg-[#36796F] text-white' : 'bg-[#f3f8f7] text-[#35645F] hover:bg-[#e6f1ef]')}>{n + 1}</button>
              );
            })}
          </div>
          <button onClick={() => setConfirm(true)} className="mt-3 w-full rounded-md bg-[#36796F] px-3 py-2 font-semibold text-white hover:bg-[#2F6A61]">Nộp bài</button>
        <p className={'mt-3 rounded-md px-3 py-2 text-center text-xs font-semibold leading-5 ' +
          (tabSwitchProtectionEnabled ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900')}>
          {tabSwitchProtectionEnabled
                ? 'Nội quy: Không chuyển tab/cửa sổ hoặc thoát toàn màn hình. Bài thi tự nộp nếu vi phạm.'
                : 'CHẾ ĐỘ THỬ ĐANG BẬT: chuyển tab không tự động nộp bài và có thể thoát toàn màn hình.'}
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
              <button autoFocus onClick={() => setConfirm(false)} className="rounded-md border border-slate-300 px-4 py-2 text-[#36796F] hover:bg-[#EDF6F4]">Tiếp tục làm bài</button>
              <button onClick={() => void submit('manual')} className="rounded-md bg-[#36796F] px-4 py-2 font-semibold text-white hover:bg-[#2F6A61]">Nộp bài</button>
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
  const [fullscreenExitError, setFullscreenExitError] = useState('');
  const [gradeRefreshError, setGradeRefreshError] = useState('');
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
  useEffect(() => {
    if (phase !== 'done' || !document.fullscreenElement) return;
    void document.exitFullscreen()
      .then(() => setFullscreenExitError(''))
      .catch(() => setFullscreenExitError('Bài đã nộp nhưng trình duyệt không tự tắt được toàn màn hình.'));
  }, [phase]);
  useEffect(() => {
    if (phase !== 'done' || !st?.pendingGrade) {
      setGradeRefreshError('');
      return;
    }
    let active = true;
    const timer = window.setInterval(() => {
      void api<St>('exam/state')
        .then((state) => {
          if (!active) return;
          setSt(state);
          setRes(state.result ?? null);
          setGradeRefreshError('');
        })
        .catch((error: Error) => {
          if (active) setGradeRefreshError(`Chưa kiểm tra được trạng thái chấm điểm: ${error.message}`);
        });
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [phase, st?.pendingGrade]);
  const returnHome = async () => {
    setResetBusy(true);
    setResetError('');
    try {
      await api('exam/reset', { method: 'POST', body: '{}' });
      setSt(null);
      setRes(null);
      setTabSwitchNotice(false);
      setFullscreenExitError('');
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
    <Shell info={info} compact={phase === 'entry'}>
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
        <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
          {fullscreenExitError && <p role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">{fullscreenExitError}</p>}
          {tabSwitchNotice && (
            <div role="alertdialog" aria-modal="true" aria-labelledby="tab-submit-notice"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <div className="w-full max-w-md rounded-xl border-2 border-red-300 bg-white p-6 text-center shadow-2xl">
                <p className="mx-auto w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-800">Vi phạm quy định thi</p>
                <h2 id="tab-submit-notice" className="mt-3 text-lg font-bold text-red-800">Bài thi đã được nộp tự động</h2>
                <p className="mt-2 text-red-800">Bạn đã chuyển sang tab khác nên hệ thống đã tự động nộp bài.</p>
                <button autoFocus onClick={() => setTabSwitchNotice(false)}
                  className="mt-5 rounded-md bg-[#294075] px-5 py-2 font-semibold text-white transition-colors hover:bg-[#172554] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2">
                  Đã hiểu
                </button>
              </div>
            </div>
          )}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#294075] to-[#172554] px-6 py-7 text-center text-white sm:px-10 sm:py-9">
            <div aria-hidden="true" className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10" />
            <div aria-hidden="true" className="absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-white/5" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
                {res ? 'BÀI THI ĐÃ HOÀN TẤT' : st?.pendingGrade ? 'ĐANG CHỜ CHẤM TỰ LUẬN' : 'NỘP BÀI THÀNH CÔNG'}
              </p>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                {res ? 'Kết quả bài thi' : st?.pendingGrade ? 'Bài thi đang được chấm' : 'Cảm ơn bạn đã tham gia'}
              </h2>
              {info?.title && <p className="mt-2 text-sm text-blue-100 sm:text-base">{info.title}</p>}
            </div>
          </div>
          <div className="px-5 py-6 sm:px-10 sm:py-8">
          {st?.pendingGrade ? (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
              <p className="text-lg font-semibold text-amber-900">Đã nộp bài thành công</p>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                Bài thi có câu tự luận và đang chờ chấm. Kết quả tổng kết sẽ tự hiển thị sau khi chấm xong.
              </p>
              <p className="mt-2 text-xs text-amber-800">Trang sẽ tự kiểm tra cập nhật điểm định kỳ.</p>
            </div>
          ) : res ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={'rounded-xl border p-5 ' + (res.result === 'PASS' ? 'border-blue-100 bg-blue-50' : 'border-red-100 bg-red-50')}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Kết quả</p>
                  <p className={'mt-2 text-3xl font-bold ' + (res.result === 'PASS' ? 'text-[#294075]' : 'text-red-700')}>
                    {res.result === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tổng điểm bài thi</p>
                  <p className="mt-2 text-3xl font-bold text-[#172554]">
                    {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(res.scoredPoints)}
                    <span className="ml-1 text-base font-medium text-slate-500">/ {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(res.totalPoints)}</span>
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">
                Đúng <b className="text-slate-800">{res.correct}</b> câu, sai hoặc bỏ trống <b className="text-slate-800">{res.incorrect}</b> câu.
                Mỗi câu được quy đổi tối đa 0,5 điểm; đạt từ 7/10 điểm.
              </p>
            </>
          ) : (
            <div role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-6 text-center">
              <p className="text-lg font-semibold text-[#172554]">Đã nộp bài thành công</p>
              <p className="mt-2 text-sm text-slate-600">Cảm ơn bạn đã hoàn thành bài kiểm tra.</p>
            </div>
          )}
          {gradeRefreshError && <p role="alert" className="mt-3 text-sm text-red-700">{gradeRefreshError}</p>}
          {/* <p className="mt-4 text-sm text-slate-600">File PDF chỉ chứa câu hỏi và lựa chọn/bài làm của bạn, không có đáp án chuẩn.</p> */}
          {exportError && <p role="alert" className="mt-3 text-sm text-red-700">{exportError}</p>}
          {resetError && <p role="alert" className="mt-4 text-sm text-red-700">{resetError}</p>}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button disabled={exportBusy} onClick={() => void downloadAnswerPdf()}
              className="min-h-12 w-full rounded-lg bg-[#294075] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#172554] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {exportBusy ? 'Đang xuất file…' : 'Tải bài làm (PDF)'}
            </button>
            <button disabled={resetBusy} onClick={() => void returnHome()}
              className="min-h-12 w-full rounded-lg border border-blue-100 bg-white px-4 py-3 text-sm font-semibold text-[#172554] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294075] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
              {resetBusy ? 'Đang quay lại…' : 'Quay lại trang chủ'}
            </button>
          </div>
          </div>
        </section>
      )}
    </Shell>
  );
}
