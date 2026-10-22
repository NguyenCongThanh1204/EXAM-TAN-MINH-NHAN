export type ApiError = Error & { status: number; fields?: Record<string, string[]> };
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch('/api/' + path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Phản hồi 500 không phải JSON nghĩa là hàm API chưa chạy được (ví dụ vercel dev bị treo), không phải lỗi dữ liệu.
    const fallback = r.status >= 500 ? 'Máy chủ gặp lỗi tạm thời. Hãy thử lại; nếu đang chạy local, khởi động lại vercel dev.' : 'Lỗi mạng';
    throw Object.assign(new Error(j.error || fallback), { status: r.status, fields: j.fields }) as ApiError;
  }
  return j as T;
}
export const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
