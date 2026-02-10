import axios from 'axios';

export function formatApiError(err: unknown, fallback: string) {
  if (axios.isAxiosError(err)) {
    const data: any = err.response?.data;
    const detail = data?.detail || err.message;
    const hint = data?.hint;
    const errorId = data?.error_id;
    const parts = [detail].filter(Boolean);
    if (hint) parts.push(`提示：${hint}`);
    if (errorId) parts.push(`错误编号：${errorId}`);
    return parts.join(' | ');
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

