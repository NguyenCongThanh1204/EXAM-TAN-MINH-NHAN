import { useEffect, useState } from 'react';
import { api } from './api';

type Item = { text: string; options: { id: string; text: string }[]; correct: string };
type Preview = { ok: boolean; total: number; needed: number; locked: boolean; errors: { ref: string; message: string }[]; preview: Item[] };
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Không đọc được tệp.')); r.readAsDataURL(f); });

function Import({ run }: { run: (f: () => Promise<void>) => Promise<void> }) {
  const [format, setFormat] = useState<'xlsx' | 'docx'>('xlsx');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const call = async (commit: boolean) => api<any>('admin/import', { method: 'POST', body: JSON.stringify({ format, mode, commit, file: await toB64(file!) }) });
  const reset = () => { setPv(null); setSaved(null); };
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="imp">
      <h2 id="imp" className="font-semibold">Nhập câu hỏi từ tệp</h2>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>Định dạng tệp{' '}
          <select value={format} onChange={(e) => { setFormat(e.target.value as 'xlsx' | 'docx'); setFile(null); reset(); }} className="rounded border border-slate-300 px-2 py-1">
            <option value="xlsx">Excel (.xlsx)</option><option value="docx">Word (.docx)</option>
          </select></label>
        <label>Cách nhập{' '}
          <select value={mode} onChange={(e) => { setMode(e.target.value as 'replace' | 'append'); reset(); }} className="rounded border border-slate-300 px-2 py-1">
            <option value="replace">Thay thế toàn bộ câu hỏi hiện có</option><option value="append">Thêm vào câu hỏi hiện có</option>
          </select></label>
        <a className="underline" href={`/api/admin/template?format=${format}`}>Tải tệp mẫu {format === 'xlsx' ? 'Excel' : 'Word'}</a>
      </div>
      <input type="file" aria-label="Chọn tệp câu hỏi" accept={format === 'xlsx' ? '.xlsx' : '.docx'} onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
      <div className="flex gap-2">
        <button disabled={!file} className="rounded-md bg-slate-800 px-4 py-2 text-white disabled:opacity-40" onClick={() => void run(async () => setPv(await call(false)))}>Kiểm tra tệp</button>
        <button disabled={!file || !pv?.ok} className="rounded-md bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
          onClick={() => { if (confirm(mode === 'replace' ? 'Thay thế TOÀN BỘ câu hỏi hiện có?' : 'Thêm các câu hỏi này?')) void run(async () => { const r = await call(true); setSaved(r.saved); setPv(null); }); }}>Lưu vào hệ thống</button>
      </div>
      {saved !== null && <p role="status" className="text-teal-800">Đã lưu {saved} câu hỏi.</p>}
      {pv && (
        <div className="space-y-2 text-sm">
          {pv.locked && <p role="alert" className="text-red-700">Đã có thí sinh bắt đầu thi: không thể đổi câu hỏi (xoá bài thi thử trong bảng exam_attempts nếu đó chỉ là thử nghiệm).</p>}
          <p>Đọc được <b>{pv.total}</b> câu hợp lệ{pv.errors.length > 0 && <>, <b className="text-red-700">{pv.errors.length} lỗi</b></>}.
            {mode === 'replace' && pv.total !== pv.needed && pv.errors.length === 0 && <span className="text-amber-800"> Kỳ thi cần ít nhất {pv.needed} câu.</span>}</p>
          {pv.errors.length > 0 && <ul className="list-disc pl-5 text-red-700">{pv.errors.map((e, i) => <li key={i}><b>{e.ref}:</b> {e.message}</li>)}</ul>}
          {pv.preview.length > 0 && (
            <ol className="max-h-64 list-decimal space-y-2 overflow-auto rounded border border-slate-200 p-3 pl-8">
              {pv.preview.map((q, i) => (
                <li key={i}><div>{q.text}</div>
                  <div className="text-slate-600">{q.options.map((o) => <span key={o.id} className={'mr-3 ' + (o.id === q.correct ? 'font-semibold text-teal-700' : '')}>{o.id.toUpperCase()}. {o.text}</span>)}</div></li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
type Settings = {
  title: string; logoUrl: string; openingAt: string; closingAt: string; durationMinutes: number;
  questionCount: number; passingPercentage: number; invitationRequired: boolean; showScore: boolean; active: boolean;
};
const inputCls = 'w-full rounded-md border border-slate-300 px-3 py-2';

function SettingsForm() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api<Settings>('admin/settings').then(setS).catch((e: Error) => setMsg(e.message)); }, []);
  if (!s) return <p className="text-sm">{msg || 'Đang tải cấu hình…'}</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    setMsg('');
    try { setS(await api<Settings>('admin/settings', { method: 'PUT', body: JSON.stringify(s) })); setMsg('Đã lưu cấu hình.'); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="cfg">
      <h2 id="cfg" className="font-semibold">Cấu hình kỳ thi (giờ Việt Nam)</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2">Tiêu đề<input className={inputCls} value={s.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Thời gian bắt đầu<input type="datetime-local" className={inputCls} value={s.openingAt} onChange={(e) => set('openingAt', e.target.value)} /></label>
        <label>Thời gian kết thúc<input type="datetime-local" className={inputCls} value={s.closingAt} onChange={(e) => set('closingAt', e.target.value)} /></label>
        <label>Thời lượng làm bài (phút)<input type="number" min={1} max={600} className={inputCls} value={s.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} /></label>
        <label>Số câu mỗi đề<input type="number" min={1} max={1000} className={inputCls} value={s.questionCount} onChange={(e) => set('questionCount', Number(e.target.value))} /></label>
        <label>Ngưỡng đạt (%)<input type="number" min={1} max={100} className={inputCls} value={s.passingPercentage} onChange={(e) => set('passingPercentage', Number(e.target.value))} /></label>
        <label>Logo (đường dẫn)<input className={inputCls} value={s.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.active} onChange={(e) => set('active', e.target.checked)} /> Mở kỳ thi</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.invitationRequired} onChange={(e) => set('invitationRequired', e.target.checked)} /> Yêu cầu mã mời</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.showScore} onChange={(e) => set('showScore', e.target.checked)} /> Hiện điểm cho thí sinh</label>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-md bg-teal-700 px-4 py-2 font-semibold text-white" onClick={() => void save()}>Lưu cấu hình</button>
        <span role="status" className="text-sm">{msg}</span>
      </div>
    </section>
  );
}

type ActiveCode = { limit: number; uses: number; createdAt: string } | null;
function Codes({ run }: { run: (f: () => Promise<void>) => Promise<void> }) {
  const [limit, setLimit] = useState(300);
  const [active, setActive] = useState<ActiveCode>(null);
  const [code, setCode] = useState<string | null>(null);
  const reload = () => api<{ active: ActiveCode }>('admin/codes').then((r) => setActive(r.active));
  useEffect(() => { void reload().catch(() => undefined); }, []);
  const create = () => {
    if (active && !confirm('Tạo mã mới sẽ thu hồi mã hiện tại (thí sinh đang dùng mã cũ vẫn thi bình thường). Tiếp tục?')) return;
    void run(async () => {
      const r = await api<{ code: string; limit: number }>('admin/codes', { method: 'POST', body: JSON.stringify({ limit }) });
      setCode(r.code);
      await reload();
    });
  };
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="codes">
      <h2 id="codes" className="font-semibold">Mã mời dùng chung</h2>
      {active && <p className="text-sm">Mã hiện tại: đã dùng <b>{active.uses}</b> / <b>{active.limit}</b> lượt (tạo lúc {new Date(active.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}).</p>}
      {!active && <p className="text-sm text-slate-600">Chưa có mã mời hoạt động.</p>}
      <div className="flex items-end gap-2">
        <div><label htmlFor="limit" className="block text-sm font-medium">Số người được dùng mã</label>
          <input id="limit" type="number" min={1} max={100000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-28 rounded-md border border-slate-300 px-3 py-2" /></div>
        <button className="rounded-md bg-slate-800 px-4 py-2 text-white" onClick={create}>Tạo mã mới</button>
        <button className="rounded-md border border-slate-300 px-4 py-2" onClick={() => void run(reload)}>Làm mới</button>
      </div>
      {code && <>
        <p className="text-sm text-amber-800">Lưu mã ngay: mã chỉ hiển thị một lần.</p>
        <input readOnly value={code} aria-label="Mã mời" className="w-full rounded-md border border-slate-300 p-2 font-mono text-lg tracking-widest" />
      </>}
    </section>
  );
}

export default function Admin() {
  const [pw, setPw] = useState('');
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setMsg(''); try { await f(); } catch (e) { setMsg((e as Error).message); } };
  const downloadAndClear = async () => {
    if (!confirm('Tải Excel rồi xóa toàn bộ lượt thi đã hoàn tất cùng câu trả lời và sự kiện liên quan? Ngân hàng câu hỏi, cấu hình và lượt dùng mã mời sẽ được giữ nguyên.')) return;
    setExportBusy(true);
    setMsg('');
    try {
      const response = await fetch('/api/admin/export?clear=true', { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Không thể tạo tệp Excel.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'examination-results.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      try {
        const result = await api<{ deleted: number }>('admin/clear-results', {
          method: 'POST',
          body: JSON.stringify({ confirm: true }),
        });
        setMsg(`Đã tải Excel và xóa ${result.deleted} lượt thi đã hoàn tất.`);
      } catch (e) {
        setMsg(`Đã tải Excel nhưng chưa xóa được dữ liệu: ${(e as Error).message}`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Quản trị kỳ thi</h1>
      {!ok ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) }); setOk(true); }); }}>
          <label htmlFor="pw" className="block text-sm font-medium">Mật khẩu quản trị</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2" autoComplete="current-password" />
          <button className="rounded-md bg-teal-700 px-4 py-2 font-semibold text-white">Đăng nhập</button>
        </form>
      ) : (
        <div className="space-y-4">
          <SettingsForm />
          <Codes run={run} />
          <Import run={run} />
          <button className="rounded-md bg-slate-800 px-4 py-2 text-white" onClick={() => void run(async () => { const r = await api<{ finalized: number }>('admin/reconcile', { method: 'POST', body: '{}' }); setMsg(`Đã chốt ${r.finalized} bài hết hạn.`); })}>Chốt các bài hết hạn</button>{' '}
          <a className="inline-block rounded-md bg-teal-700 px-4 py-2 font-semibold text-white" href="/api/admin/export">Tải kết quả (giữ dữ liệu)</a>{' '}
          <button disabled={exportBusy} className="rounded-md bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-60" onClick={() => void downloadAndClear()}>
            {exportBusy ? 'Đang tải và xóa…' : 'Tải Excel và xóa dữ liệu kết quả'}
          </button>
          <p className="text-sm text-slate-600">Chức năng xóa chỉ hoạt động khi kỳ thi đã đóng và không còn bài đang làm. Câu hỏi, cấu hình và lượt dùng mã mời không bị xóa.</p>
        </div>
      )}
      {msg && <p role="alert" className="text-sm">{msg}</p>}
    </main>
  );
}
