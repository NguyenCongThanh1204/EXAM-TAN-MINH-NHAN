import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useUi } from './ui';
import type { ExamDashboard, DashboardMetric } from '../api/_lib/dashboard';

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
  multipleChoiceCount: number; essayCount: number; passingScore: number; invitationRequired: boolean; showScore: boolean;
  displayMode: 'paged' | 'all'; active: boolean;
};
type ActiveCode = { limit: number; uses: number; createdAt: string } | null;
type Project = { id: string; name: string; active: boolean };

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
          <Field label="Điểm đạt (thang 10)" hint="Ví dụ 7,5/10 tương đương ngưỡng 75%.">
            <input type="number" min={0.1} max={10} step={0.1} className={inputCls} value={s.passingScore}
              onChange={(e) => set('passingScore', Number(e.target.value))} />
          </Field>
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

function Projects({ run }: { run: Run }) {
  const { confirm, toast } = useUi();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => api<{ projects: Project[] }>('admin/projects').then((r) => setProjects(r.projects));
  useEffect(() => { void reload().catch((e: Error) => toast('error', e.message)); }, [toast]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setBusy(true);
      try {
        const project = await api<Project>('admin/projects', { method: 'POST', body: JSON.stringify({ name }) });
        setProjects((current) => [...(current ?? []), project].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
        setName('');
        toast('success', 'Đã thêm công trình vào danh sách.');
      } finally {
        setBusy(false);
      }
    });
  };

  const setActive = (project: Project) => void run(async () => {
    const updated = await api<Project>('admin/projects', {
      method: 'PUT',
      body: JSON.stringify({ id: project.id, active: !project.active }),
    });
    setProjects((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? []);
    toast('success', updated.active ? 'Đã mở lựa chọn công trình.' : 'Đã ẩn công trình khỏi lựa chọn; dữ liệu bài thi cũ được giữ nguyên.');
  });

  const deleteProject = (project: Project) => void run(async () => {
    const ok = await confirm({
      title: `Xóa công trình "${project.name}"?`,
      message: 'Chỉ xóa được công trình chưa có bài thi liên quan. Nếu đã có dữ liệu cũ, hãy dùng nút Ẩn để giữ lịch sử và thống kê.',
      confirmText: 'Xóa công trình',
      danger: true,
    });
    if (!ok) return;
    await api<{ id: string }>('admin/projects', {
      method: 'DELETE',
      body: JSON.stringify({ id: project.id }),
    });
    setProjects((current) => current?.filter((item) => item.id !== project.id) ?? []);
    toast('success', 'Đã xóa công trình.');
  });

  return (
    <Card id="project-catalog" title="Danh sách công trình" desc="Có thể xóa công trình chưa từng được dùng. Công trình đã liên quan đến bài thi chỉ có thể ẩn để giữ dữ liệu lịch sử.">
      <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Tên công trình mới" className="flex-1">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </Field>
        <button className={btnPrimary} disabled={busy || !name.trim()}>{busy ? 'Đang thêm…' : 'Thêm công trình'}</button>
      </form>
      {projects === null ? <p className="text-sm text-slate-500">Đang tải danh sách…</p>
        : projects.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Chưa có công trình. Hãy thêm danh sách trước khi mở kỳ thi cho thí sinh.</p>
          : <ul className="max-h-80 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{project.name}</span>
                  <span className={'text-xs ' + (project.active ? 'text-emerald-700' : 'text-slate-500')}>{project.active ? 'Đang cho phép chọn' : 'Đã ẩn · dữ liệu lịch sử được giữ'}</span>
                </span>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={project.active ? btnGhost : btnPrimary}
                    onClick={() => setActive(project)}>
                    {project.active ? 'Ẩn' : 'Kích hoạt'}
                  </button>
                  <button type="button" className={btnDanger} onClick={() => deleteProject(project)}>Xóa</button>
                </div>
              </li>
            ))}
          </ul>}
    </Card>
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
      <p className="text-xs text-slate-500">Mỗi câu trắc nghiệm có 1 điểm nội bộ; hệ thống tự quy đổi tổng điểm về thang 10. Với 20 câu, mỗi câu đúng tương đương 0,5 điểm. Cột điểm trong mẫu chỉ nhập cho câu tự luận.</p>
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
                  <div>{q.text} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{q.type === 'essay' ? `tự luận, tối đa ${q.points} điểm` : `${q.type === 'multiple' ? 'nhiều đáp án' : 'một đáp án'}, 1 điểm nội bộ`}</span></div>
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

type DashboardResponse = { dashboard: ExamDashboard; levelOptions: string[] };
type DashboardGroup = { label: string; metric: DashboardMetric };
const scoreLabels = ['0,0–0,9', '1,0–1,9', '2,0–2,9', '3,0–3,9', '4,0–4,9', '5,0–5,9', '6,0–6,9', '7,0–7,9', '8,0–8,9', '9,0–9,9', '10'];
const countFormat = new Intl.NumberFormat('vi-VN');
const percentFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const scoreFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const displayPercent = (value: number | null) => value === null ? '—' : `${percentFormat.format(value)}%`;
const displayScore = (value: number | null) => value === null ? '—' : `${scoreFormat.format(value)} / 10`;

function DashboardChart({ metric }: { metric: DashboardMetric }) {
  const decided = metric.pass + metric.fail;
  const passPercentage = decided ? (metric.pass / decided) * 100 : 0;
  const gradient = decided
    ? `conic-gradient(#0f766e 0% ${passPercentage}%, #dc2626 ${passPercentage}% 100%)`
    : '#e2e8f0';
  const maxCount = Math.max(1, ...metric.scoreDistribution.map((bucket) => bucket.count));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="dashboard-pass-title" className="rounded-xl border border-slate-200 p-4">
        <h3 id="dashboard-pass-title" className="text-sm font-semibold text-slate-800">Tỷ lệ đạt / không đạt</h3>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div role="img" aria-label={`Tỷ lệ đạt ${displayPercent(passPercentage)} trong ${countFormat.format(decided)} bài đã có kết quả`}
            className="flex h-36 w-36 items-center justify-center rounded-full"
            style={{ background: gradient }}>
            <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white text-center">
              <span className="text-lg font-bold text-slate-900">{displayPercent(decided ? passPercentage : null)}</span>
              <span className="text-xs text-slate-500">đạt</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-teal-700" />Đạt: <b>{countFormat.format(metric.pass)}</b></p>
            <p className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-red-600" />Không đạt: <b>{countFormat.format(metric.fail)}</b></p>
            <p className="text-slate-500">Chưa có kết quả: {countFormat.format(metric.pending)}</p>
          </div>
        </div>
      </section>
      <section aria-labelledby="dashboard-score-title" className="rounded-xl border border-slate-200 p-4">
        <h3 id="dashboard-score-title" className="text-sm font-semibold text-slate-800">Phân bố điểm trắc nghiệm (thang 10)</h3>
        <div role="img" aria-label="Biểu đồ số bài thi theo khoảng điểm trên thang 10"
          className="mt-4 flex h-40 items-end gap-1 border-b border-l border-slate-200 px-2">
          {metric.scoreDistribution.map((bucket) => (
            <div key={bucket.label} title={`${bucket.label}/10: ${countFormat.format(bucket.count)} bài`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {bucket.count > 0 && <span className="mb-1 text-[10px] text-slate-600">{countFormat.format(bucket.count)}</span>}
              <div className="w-full max-w-7 rounded-t bg-teal-600 transition-all"
                style={{ height: `${bucket.count ? Math.max(4, (bucket.count / maxCount) * 100) : 0}%` }} />
              <span className="mt-1 whitespace-nowrap text-[9px] text-slate-500">{bucket.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Mỗi khoảng rộng 1 điểm trên thang 10.</p>
      </section>
    </div>
  );
}

function ResultsDashboard() {
  const [projectId, setProjectId] = useState('');
  const [level, setLevel] = useState('');
  const [scoreBucket, setScoreBucket] = useState('');
  const [compareBy, setCompareBy] = useState<'project' | 'level'>('project');
  const [response, setResponse] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResponse(null);
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (level) params.set('level', level);
    if (scoreBucket) params.set('scoreBucket', scoreBucket);
    const query = params.size ? `?${params.toString()}` : '';
    api<DashboardResponse>(`admin/dashboard${query}`)
      .then((data) => { if (active) setResponse(data); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, level, scoreBucket, refresh]);

  const dashboard = response?.dashboard;
  const metric = dashboard?.overall;
  const groups: DashboardGroup[] = compareBy === 'project'
    ? (dashboard?.projects ?? []).map((project) => ({ label: project.name, metric: project }))
    : (dashboard?.levels ?? []).map((item) => ({ label: item.level, metric: item }));

  return (
    <Card id="res-dashboard" title="Thống kê kết quả thi" desc="Chỉ tính các lượt đã nộp; bài đang làm không được đưa vào thống kê.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Công trình">
          <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Tất cả công trình</option>
            {dashboard?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.active ? '' : ' (đã ẩn)'}</option>)}
          </select>
        </Field>
        <Field label="Cấp bậc">
          <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Tất cả cấp bậc</option>
            {response?.levelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <Field label="Khoảng điểm trắc nghiệm">
          <select className={inputCls} value={scoreBucket} onChange={(e) => setScoreBucket(e.target.value)}>
            <option value="">Tất cả điểm</option>
            {scoreLabels.map((label, index) => <option key={label} value={index}>{label} điểm</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button type="button" className={btnGhost + ' w-full'} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
            {loading ? 'Đang tải…' : 'Làm mới số liệu'}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && !metric && <p role="status" className="text-sm text-slate-500">Đang tải thống kê…</p>}
      {metric && (
        <div aria-busy={loading} className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Tổng lượt đã nộp', value: countFormat.format(metric.total), color: 'text-slate-900' },
              { label: 'Đạt', value: countFormat.format(metric.pass), color: 'text-teal-700' },
              { label: 'Không đạt', value: countFormat.format(metric.fail), color: 'text-red-700' },
              { label: 'Điểm trắc nghiệm trung bình', value: displayScore(metric.averageScore), color: 'text-slate-900' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-500">{item.label}</p>
                <p className={'mt-1 text-2xl font-bold ' + item.color}>{item.value}</p>
              </div>
            ))}
          </div>

          <DashboardChart metric={metric} />

          <section aria-labelledby="dashboard-groups-title" className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="dashboard-groups-title" className="text-sm font-semibold text-slate-800">So sánh tỷ lệ đạt theo nhóm</h3>
                <p className="mt-1 text-xs text-slate-500">Tỷ lệ được tính trên các bài đã có kết quả đạt hoặc không đạt.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" aria-pressed={compareBy === 'project'} onClick={() => setCompareBy('project')}
                  className={compareBy === 'project' ? btnPrimary : btnGhost}>Công trình</button>
                <button type="button" aria-pressed={compareBy === 'level'} onClick={() => setCompareBy('level')}
                  className={compareBy === 'level' ? btnPrimary : btnGhost}>Cấp bậc</button>
              </div>
            </div>
            {groups.length === 0 || !metric.total ? (
              <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Không có dữ liệu phù hợp với bộ lọc.</p>
            ) : (
              <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {groups.map(({ label, metric: group }) => {
                  const completed = group.pass + group.fail;
                  const rate = completed ? (group.pass / completed) * 100 : 0;
                  return (
                    <div key={label} className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_2fr_auto] sm:items-center">
                      <span className="truncate text-sm font-medium text-slate-700" title={label}>{label}</span>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="img"
                        aria-label={`${label}: tỷ lệ đạt ${displayPercent(completed ? rate : null)}`}>
                        <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${rate}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-slate-600">
                        {completed ? `${displayPercent(rate)} · ${group.pass}/${completed} đạt` : 'Chưa có kết quả'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
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
      <ResultsDashboard />
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
        {tab === 'settings' && <div className="space-y-6"><SettingsForm run={run} /><Projects run={run} /></div>}
        {tab === 'codes' && <Codes run={run} />}
        {tab === 'questions' && <Import run={run} />}
        {tab === 'results' && <Results run={run} />}
      </main>
    </div>
  );
}
