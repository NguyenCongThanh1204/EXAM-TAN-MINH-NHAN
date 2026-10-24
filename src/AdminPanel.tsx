import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useUi } from './ui';

type Item = {
  text: string; type: 'single' | 'multiple' | 'essay'; points: number;
  options: { id: string; text: string }[]; correct: string[]; referenceAnswer: string;
};
type Preview = {
  ok: boolean; total: number; availableMultiple: number; availableEssay: number;
  neededMultiple: number; neededEssay: number; pickedMultiple: number; pickedEssay: number;
  locked: boolean; errors: { ref: string; message: string }[]; preview: Item[];
};
type Run = (f: () => Promise<void>) => Promise<void>;
type Settings = {
  title: string; openingAt: string; closingAt: string; durationMinutes: number;
  multipleChoiceCount: number; essayCount: number; passingPercentage: number; invitationRequired: boolean; showScore: boolean;
  displayMode: 'paged' | 'all'; active: boolean;
};
type ActiveCode = { limit: number; uses: number; createdAt: string } | null;

const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Không đọc được tệp.')); r.readAsDataURL(f); });
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20';
const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50';
const btnDark = 'inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const btnDanger = 'inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50';

function Card({ id, title, desc, children }: { id: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 id={id} className="text-base font-semibold text-slate-900">{title}</h2>
      {desc && <p className="mt-1 text-sm text-slate-500">{desc}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={'block ' + className}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-teal-600 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const MODES: { id: Settings['displayMode']; title: string; desc: string }[] = [
  { id: 'paged', title: 'Từng câu một', desc: 'Thí sinh làm lần lượt từng câu, dùng nút Câu trước/Câu sau hoặc bảng số câu.' },
  { id: 'all', title: 'Hiện tất cả câu cùng lúc', desc: 'Toàn bộ câu hỏi nằm trên một trang cuộn xuống; bảng số câu giúp nhảy nhanh tới từng câu.' },
];

function SettingsForm({ run }: { run: Run }) {
  const { toast } = useUi();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Settings>('admin/settings').then(setS).catch((e: Error) => toast('error', e.message)); }, [toast]);
  if (!s) return <p className="text-sm text-slate-500">Đang tải cấu hình…</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = () => void run(async () => {
    setBusy(true);
    try { setS(await api<Settings>('admin/settings', { method: 'PUT', body: JSON.stringify(s) })); toast('success', 'Đã lưu cấu hình kỳ thi.'); }
    finally { setBusy(false); }
  });
  return (
    <div className="space-y-6">
      <Card id="cfg-general" title="Thông tin kỳ thi" desc="Thời gian nhập theo giờ Việt Nam.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tiêu đề" className="sm:col-span-2"><input className={inputCls} value={s.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Thời gian bắt đầu"><input type="datetime-local" className={inputCls} value={s.openingAt} onChange={(e) => set('openingAt', e.target.value)} /></Field>
          <Field label="Thời gian kết thúc"><input type="datetime-local" className={inputCls} value={s.closingAt} onChange={(e) => set('closingAt', e.target.value)} /></Field>
          <Field label="Thời lượng làm bài (phút)"><input type="number" min={1} max={600} className={inputCls} value={s.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} /></Field>
          <Field label="Số câu trắc nghiệm" ><input type="number" min={0} max={1000} className={inputCls} value={s.multipleChoiceCount} onChange={(e) => set('multipleChoiceCount', Number(e.target.value))} /></Field>
          <Field label="Số câu tự luận" ><input type="number" min={0} max={1000} className={inputCls} value={s.essayCount} onChange={(e) => set('essayCount', Number(e.target.value))} /></Field>
          <Field label="Ngưỡng đạt (%)"><input type="number" min={1} max={100} className={inputCls} value={s.passingPercentage} onChange={(e) => set('passingPercentage', Number(e.target.value))} /></Field>
        </div>
      </Card>

      <Card id="cfg-mode" title="Cách hiển thị bài làm" desc="Áp dụng cho các thí sinh bắt đầu hoặc tải lại bài thi sau khi lưu.">
        <div role="radiogroup" aria-labelledby="cfg-mode" className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <label key={m.id} className={'flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition ' + (s.displayMode === m.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300')}>
              <input type="radio" name="displayMode" className="mt-1 accent-teal-700" checked={s.displayMode === m.id} onChange={() => set('displayMode', m.id)} />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{m.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-600">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card id="cfg-access" title="Truy cập và kết quả">
        <div className="grid gap-3 sm:grid-cols-3">
          <Switch checked={s.active} onChange={(v) => set('active', v)} label="Mở kỳ thi" hint="Tắt để đóng ngay lập tức." />
          <Switch checked={s.invitationRequired} onChange={(v) => set('invitationRequired', v)} label="Yêu cầu mã mời" hint="Thí sinh phải nhập mã." />
          <Switch checked={s.showScore} onChange={(v) => set('showScore', v)} label="Hiện điểm" hint="Hiện điểm trắc nghiệm sau khi nộp." />
        </div>
      </Card>

      <div className="flex justify-end">
        <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button>
      </div>
    </div>
  );
}

function Codes({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [limit, setLimit] = useState(300);
  const [active, setActive] = useState<ActiveCode>(null);
  const [code, setCode] = useState<string | null>(null);
  const reload = () => api<{ active: ActiveCode }>('admin/codes').then((r) => setActive(r.active));
  useEffect(() => { void reload().catch(() => undefined); }, []);
  const create = async () => {
    if (active && !(await confirm({
      title: 'Tạo mã mời mới?', confirmText: 'Tạo mã mới', danger: true,
      message: 'Mã hiện tại sẽ bị thu hồi. Thí sinh đang dùng mã cũ vẫn thi bình thường.',
    }))) return;
    void run(async () => {
      const r = await api<{ code: string; limit: number }>('admin/codes', { method: 'POST', body: JSON.stringify({ limit }) });
      setCode(r.code);
      await reload();
      toast('success', 'Đã tạo mã mời mới.');
    });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code!); toast('success', 'Đã sao chép mã mời.'); }
    catch { toast('error', 'Không sao chép được, hãy chọn và sao chép thủ công.'); }
  };
  const pct = active ? Math.min(100, Math.round((active.uses / active.limit) * 100)) : 0;
  return (
    <Card id="codes" title="Mã mời dùng chung" desc="Chỉ có một mã hoạt động tại một thời điểm.">
      {active ? (
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-600">Đã dùng <b className="text-slate-900">{active.uses}</b> / <b className="text-slate-900">{active.limit}</b> lượt</span>
            <span className="text-xs text-slate-500">Tạo lúc {new Date(active.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-600" style={{ width: pct + '%' }} /></div>
        </div>
      ) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Chưa có mã mời hoạt động.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Số người được dùng mã" className="w-48">
          <input type="number" min={1} max={100000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className={inputCls} />
        </Field>
        <button className={btnDark} onClick={() => void create()}>Tạo mã mới</button>
        <button className={btnGhost} onClick={() => void run(reload)}>Làm mới</button>
      </div>
      {code && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Lưu mã ngay: mã chỉ hiển thị một lần.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly value={code} aria-label="Mã mời" className="w-full rounded-lg border border-amber-300 bg-white p-2 text-center font-mono text-xl tracking-[0.3em]" />
            <button className={btnPrimary} onClick={() => void copy()}>Sao chép</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Import({ run }: { run: Run }) {
  const { confirm } = useUi();
  const [format, setFormat] = useState<'xlsx' | 'docx'>('xlsx');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const call = async (commit: boolean) => api<any>('admin/import', { method: 'POST', body: JSON.stringify({ format, mode, commit, file: await toB64(file!) }) });
  const reset = () => { setPv(null); setSaved(null); };
  const commit = async () => {
    const ok = await confirm(mode === 'replace'
      ? { title: 'Thay thế toàn bộ câu hỏi?', message: 'Toàn bộ câu hỏi hiện có sẽ bị xóa và thay bằng nội dung trong tệp.', confirmText: 'Thay thế', danger: true }
      : { title: 'Thêm các câu hỏi này?', message: 'Các câu hỏi trong tệp sẽ được thêm vào ngân hàng câu hỏi hiện có.', confirmText: 'Thêm câu hỏi' });
    if (ok) void run(async () => { const r = await call(true); setSaved(r.saved); setPv(null); });
  };
  return (
    <Card id="imp" title="Nhập câu hỏi từ tệp" desc="Hỗ trợ Excel và Word. Kiểm tra tệp trước khi lưu vào hệ thống.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Định dạng tệp">
          <select value={format} onChange={(e) => { setFormat(e.target.value as 'xlsx' | 'docx'); setFile(null); reset(); }} className={inputCls}>
            <option value="xlsx">Excel (.xlsx)</option><option value="docx">Word (.docx)</option>
          </select>
        </Field>
        <Field label="Cách nhập">
          <select value={mode} onChange={(e) => { setMode(e.target.value as 'replace' | 'append'); reset(); }} className={inputCls}>
            <option value="replace">Thay thế toàn bộ câu hỏi hiện có</option><option value="append">Thêm vào câu hỏi hiện có</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-4">
        <input type="file" aria-label="Chọn tệp câu hỏi" accept={format === 'xlsx' ? '.xlsx' : '.docx'}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
        <a className="ml-auto text-sm font-medium text-teal-700 underline-offset-2 hover:underline" href={`/api/admin/template?format=${format}`}>Tải tệp mẫu {format === 'xlsx' ? 'Excel' : 'Word'}</a>
      </div>
      <div className="flex gap-2">
        <button disabled={!file} className={btnDark} onClick={() => void run(async () => setPv(await call(false)))}>Kiểm tra tệp</button>
        <button disabled={!file || !pv?.ok} className={btnPrimary} onClick={() => void commit()}>Lưu vào hệ thống</button>
      </div>
      {saved !== null && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Đã lưu {saved} câu hỏi.</p>}
      {pv && (
        <div className="space-y-3 text-sm">
          {pv.locked && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">Đã có thí sinh bắt đầu thi: không thể đổi câu hỏi (xoá bài thi thử trong bảng exam_attempts nếu đó chỉ là thử nghiệm).</p>}
          <p className="text-slate-700">Đọc được <b>{pv.total}</b> câu hợp lệ. Sau khi nhập, mỗi thí sinh nhận ngẫu nhiên tối đa <b>{pv.pickedMultiple}</b> câu trắc nghiệm và <b>{pv.pickedEssay}</b> câu tự luận (cấu hình: {pv.neededMultiple} trắc nghiệm, {pv.neededEssay} tự luận).{pv.errors.length > 0 && <>, <b className="text-red-700">{pv.errors.length} lỗi</b></>}</p>
          {pv.errors.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-red-50 p-3 pl-8 text-red-800">{pv.errors.map((e, i) => <li key={i}><b>{e.ref}:</b> {e.message}</li>)}</ul>}
          {pv.preview.length > 0 && (
            <ol className="max-h-72 list-decimal space-y-3 overflow-auto rounded-xl border border-slate-200 p-4 pl-9">
              {pv.preview.map((q, i) => (
                <li key={i}>
                  <div>{q.text} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{q.type === 'essay' ? `tự luận, tối đa ${q.points} điểm` : `${q.type === 'multiple' ? 'nhiều đáp án' : 'một đáp án'}, 1 điểm`}</span></div>
                  {q.type !== 'essay' && <div className="mt-1 flex flex-wrap gap-x-4 text-slate-600">{q.options.map((o) => <span key={o.id} className={q.correct.includes(o.id) ? 'font-semibold text-teal-700' : ''}>{o.id.toUpperCase()}. {o.text}</span>)}</div>}
                  {q.type === 'essay' && <div className="mt-1 text-slate-600">Đáp án tham khảo: {q.referenceAnswer}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}

function Results({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState(false);
  const downloadAndClear = async () => {
    const ok = await confirm({
      title: 'Tải hồ sơ rồi xóa dữ liệu kết quả?', confirmText: 'Tải và xóa', danger: true,
      message: 'Toàn bộ lượt thi đã hoàn tất cùng câu trả lời và sự kiện liên quan sẽ bị xóa sau khi tải. Ngân hàng câu hỏi, cấu hình và lượt dùng mã mời được giữ nguyên.',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/export?clear=true', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Không thể tạo bộ hồ sơ phúc khảo.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'examination-review.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      try {
        const result = await api<{ deleted: number }>('admin/clear-results', { method: 'POST', body: JSON.stringify({ confirm: true }) });
        toast('success', `Đã tải bộ hồ sơ và xóa ${result.deleted} lượt thi đã hoàn tất.`);
      } catch (e) {
        toast('error', `Đã tải bộ hồ sơ nhưng chưa xóa được dữ liệu: ${(e as Error).message}`);
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <Card id="res-export" title="Kết quả thi và hồ sơ phúc khảo" desc="Tải một file ZIP gồm bảng Excel và PDF riêng cho từng bài thi đã nộp. Trong file Excel, sheet Hồ sơ phúc khảo có liên kết đến PDF tương ứng.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold">Tải hồ sơ (giữ dữ liệu)</h3>
            <p className="mt-1 text-xs text-slate-500">ZIP gồm Excel và PDF phúc khảo; dữ liệu vẫn được giữ trên hệ thống.</p>
            <a className={btnPrimary + ' mt-3'} href="/api/admin/export">Tải ZIP hồ sơ</a>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
            <h3 className="text-sm font-semibold text-red-900">Tải hồ sơ và xóa dữ liệu kết quả</h3>
            <p className="mt-1 text-xs text-red-800/80">Chỉ chạy khi kỳ thi đã đóng và không còn bài đang làm.</p>
            <button disabled={busy} className={btnDanger + ' mt-3'} onClick={() => void downloadAndClear()}>{busy ? 'Đang tải và xóa…' : 'Tải ZIP và xóa dữ liệu'}</button>
          </div>
        </div>
      </Card>
      <Card id="res-reconcile" title="Chốt bài hết hạn" desc="Tự động nộp các bài đã quá hạn mà thí sinh chưa nộp.">
        <button className={btnDark} onClick={() => void run(async () => {
          const r = await api<{ finalized: number }>('admin/reconcile', { method: 'POST', body: '{}' });
          toast('success', `Đã chốt ${r.finalized} bài hết hạn.`);
        })}>Chốt các bài hết hạn</button>
      </Card>
    </div>
  );
}

const TABS = [
  { id: 'settings', label: 'Cấu hình' },
  { id: 'codes', label: 'Mã mời' },
  { id: 'questions', label: 'Câu hỏi' },
  { id: 'results', label: 'Kết quả' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function Admin() {
  const { toast } = useUi();
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<Tab>('settings');
  const run: Run = async (f) => { try { await f(); } catch (e) { toast('error', (e as Error).message); } };

  if (!ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 p-6">
        <form className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-2xl"
          onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) }); setOk(true); }); }}>
          <div className="text-center">
            <img src="/logo.png" alt="Logo" className="mx-auto h-8 w-auto max-w-36 object-contain" />
            <h1 className="mt-2 text-xl font-semibold text-slate-900">Quản trị kỳ thi</h1>
            <p className="text-sm text-slate-500">Đăng nhập để tiếp tục</p>
          </div>
          <Field label="Mật khẩu quản trị">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} autoComplete="current-password" autoFocus />
          </Field>
          <button className={btnPrimary + ' w-full'}>Đăng nhập</button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-gradient-to-r from-slate-900 to-teal-900 text-white">
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <h1 className="text-xl font-semibold">Quản trị kỳ thi</h1>
          <p className="text-sm text-teal-100/80">Cấu hình, mã mời, ngân hàng câu hỏi và kết quả</p>
          <div role="tablist" aria-label="Mục quản trị" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={'whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ' + (tab === t.id ? 'bg-slate-100 text-slate-900' : 'text-teal-50/80 hover:bg-white/10')}>{t.label}</button>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6" role="tabpanel">
        {tab === 'settings' && <SettingsForm run={run} />}
        {tab === 'codes' && <Codes run={run} />}
        {tab === 'questions' && <Import run={run} />}
        {tab === 'results' && <Results run={run} />}
      </main>
    </div>
  );
}
