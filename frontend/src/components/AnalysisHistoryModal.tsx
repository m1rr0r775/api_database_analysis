import React from 'react';
import ModalShell from './ModalShell';
import type { AnalysisSessionRecord } from '../analysisSessions';

export default function AnalysisHistoryModal(props: {
  open: boolean;
  sessions: AnalysisSessionRecord[];
  onClose: () => void;
  onOpenSession: (s: AnalysisSessionRecord) => void;
  onDeleteSession: (s: AnalysisSessionRecord) => void;
}) {
  const { open, sessions, onClose, onOpenSession, onDeleteSession } = props;

  const fmt = (ts: number) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  };

  return (
    <ModalShell
      open={open}
      title="分析历史"
      subtitle="本地保存；可打开或删除（删除仅清理网页端记录）"
      onClose={onClose}
      maxWidthClassName="max-w-4xl"
    >
      {!sessions.length ? (
        <div className="text-sm text-gray-500">暂无历史记录。</div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="p-3 rounded border bg-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{s.title || '未命名分析'}</div>
                <div className="text-xs text-gray-500 truncate">
                  {fmt(s.createdAt)}
                  {!!s.fileNames?.length ? ` | 数据表：${s.fileNames.slice(0, 3).join('、')}${s.fileNames.length > 3 ? '…' : ''}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onOpenSession(s)} className="px-3 py-2 text-sm border rounded hover:bg-gray-50">
                  打开
                </button>
                <button
                  onClick={() => onDeleteSession(s)}
                  className="px-3 py-2 text-sm border rounded hover:bg-gray-50 text-red-600 border-red-200"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

