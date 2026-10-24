import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type ConfirmOptions = { title: string; message: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean };
type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; text: string };
type Ctx = { confirm: (o: ConfirmOptions) => Promise<boolean>; toast: (kind: ToastKind, text: string) => void };

const UiContext = createContext<Ctx | null>(null);

export function useUi(): Ctx {
  const c = useContext(UiContext);
  if (!c) throw new Error('useUi phải nằm trong UiProvider');
  return c;
}

const TOAST_STYLE: Record<ToastKind, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
};
const TOAST_ICON: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' };
const TOAST_DOT: Record<ToastKind, string> = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-sky-600' };

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), []);
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null); };

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000);
  }, [dismiss]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { dialog.resolve(false); setDialog(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog]);

  return (
    <UiContext.Provider value={{ confirm, toast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={'pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg ' + TOAST_STYLE[t.kind]}>
            <span className={'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ' + TOAST_DOT[t.kind]}>{TOAST_ICON[t.kind]}</span>
            <p className="flex-1 text-sm leading-5">{t.text}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Đóng thông báo" className="text-lg leading-none opacity-60 hover:opacity-100">×</button>
          </div>
        ))}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="ui-dlg-title" aria-describedby="ui-dlg-msg" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <span className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ' + (dialog.danger ? 'bg-red-100 text-red-700' : 'bg-teal-100 text-teal-700')}>{dialog.danger ? '!' : '?'}</span>
              <div>
                <h2 id="ui-dlg-title" className="text-lg font-semibold text-slate-900">{dialog.title}</h2>
                <div id="ui-dlg-msg" className="mt-1 text-sm leading-6 text-slate-600">{dialog.message}</div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button autoFocus onClick={() => close(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{dialog.cancelText ?? 'Hủy'}</button>
              <button onClick={() => close(true)} className={'rounded-lg px-4 py-2 text-sm font-semibold text-white ' + (dialog.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-700 hover:bg-teal-800')}>{dialog.confirmText ?? 'Xác nhận'}</button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}
