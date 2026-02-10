import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatApiError } from '../apiError';
import ModalShell from './ModalShell';

type Suggestion = {
  left_file_id: string;
  right_file_id: string;
  left_key: string;
  right_key: string;
  confidence: string;
  relation_type: string;
};

export default function ModelerModal(props: {
  open: boolean;
  sessionId: string;
  files: any[];
  onClose: () => void;
  onCreated: (file: any) => void;
}) {
  const { open, sessionId, files, onClose, onCreated } = props;
  const tables = useMemo(() => files.filter((f) => f.columns?.length && f.kind !== 'excel_workbook'), [files]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  const [how, setHow] = useState<'left' | 'inner' | 'right' | 'outer'>('left');
  const [name, setName] = useState('model_join');
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const left = tables.find((t) => t.file_id === leftId) || null;
  const right = tables.find((t) => t.file_id === rightId) || null;

  const refreshSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`/api/sessions/${sessionId}/model/suggest/`, {
        file_ids: tables.map((t) => t.file_id),
      });
      setSuggestions(res.data.suggestions || []);
    } catch (e: any) {
      setError(formatApiError(e, '获取关联建议失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuggestions([]);
    const first = tables[0]?.file_id || '';
    const second = tables[1]?.file_id || '';
    setLeftId(first);
    setRightId(second);
    setLeftKey('');
    setRightKey('');
    setHow('left');
    setName('model_join');
    refreshSuggestions().catch(() => {});
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    if (!leftId || !rightId) return;
    if (leftId !== rightId) return;
    const alt = tables.find((t) => t.file_id !== leftId)?.file_id;
    if (alt) setRightId(alt);
  }, [leftId, rightId, open]);

  useEffect(() => {
    if (!open) return;
    if (!leftId || !rightId) return;
    const s = suggestions.find((x) => x.left_file_id === leftId && x.right_file_id === rightId);
    const s2 = suggestions.find((x) => x.left_file_id === rightId && x.right_file_id === leftId);
    const best = s || s2;
    if (best) {
      if (best.left_file_id === leftId) {
        setLeftKey(best.left_key);
        setRightKey(best.right_key);
      } else {
        setLeftKey(best.right_key);
        setRightKey(best.left_key);
      }
    }
  }, [leftId, rightId, suggestions, open]);

  if (!open) return null;

  return (
    <ModalShell
      open={open}
      title="数据模型构建器（两表关联）"
      onClose={onClose}
      maxWidthClassName="max-w-4xl"
    >
      <div className="space-y-3">
        {!!error && <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded border bg-gray-50">
                <div className="text-sm font-medium text-gray-800 mb-2">左表</div>
                <select value={leftId} onChange={(e) => setLeftId(e.target.value)} className="w-full text-sm border rounded p-2">
                  {tables.map((t) => (
                    <option key={t.file_id} value={t.file_id} disabled={t.file_id === rightId}>
                      {t.filename}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-gray-500">Rows: {left?.row_count ?? '-'} | Cols: {left?.columns?.length ?? '-'}</div>
              </div>

              <div className="p-3 rounded border bg-gray-50">
                <div className="text-sm font-medium text-gray-800 mb-2">右表</div>
                <select value={rightId} onChange={(e) => setRightId(e.target.value)} className="w-full text-sm border rounded p-2">
                  {tables.map((t) => (
                    <option key={t.file_id} value={t.file_id} disabled={t.file_id === leftId}>
                      {t.filename}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-gray-500">Rows: {right?.row_count ?? '-'} | Cols: {right?.columns?.length ?? '-'}</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <div className="text-sm text-gray-700 mb-1">左表关联字段</div>
                <input value={leftKey} onChange={(e) => setLeftKey(e.target.value)} className="w-full text-sm border rounded p-2" placeholder="例如 订单ID" />
              </div>
              <div className="col-span-2">
                <div className="text-sm text-gray-700 mb-1">右表关联字段</div>
                <input value={rightKey} onChange={(e) => setRightKey(e.target.value)} className="w-full text-sm border rounded p-2" placeholder="例如 订单ID" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-sm text-gray-700 mb-1">连接类型</div>
                <select value={how} onChange={(e) => setHow(e.target.value as any)} className="w-full text-sm border rounded p-2">
                  <option value="left">左连接</option>
                  <option value="inner">内连接</option>
                  <option value="right">右连接</option>
                  <option value="outer">全连接</option>
                </select>
              </div>
              <div className="col-span-2">
                <div className="text-sm text-gray-700 mb-1">结果表名称（用于文件名）</div>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-sm border rounded p-2" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button onClick={refreshSuggestions} disabled={loading} className="px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">
                {loading ? '分析中...' : '刷新关联建议'}
              </button>
              <button
                onClick={async () => {
                  setBuilding(true);
                  setError(null);
                  try {
                    const res = await axios.post(`/api/sessions/${sessionId}/model/build/`, {
                      left_file_id: leftId,
                      right_file_id: rightId,
                      left_key: leftKey,
                      right_key: rightKey,
                      how,
                      name,
                    });
                    onCreated(res.data.file);
                    onClose();
                  } catch (e: any) {
                    setError(formatApiError(e, '创建合并视图失败'));
                  } finally {
                    setBuilding(false);
                  }
                }}
                disabled={!leftId || !rightId || !leftKey.trim() || !rightKey.trim() || building}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {building ? '创建中...' : '生成合并视图'}
              </button>
            </div>

            <div className="text-xs text-gray-500">
              说明：建议值基于字段名相似度与唯一性推断（可手动修改）；复杂多级关联可多次生成中间视图继续关联。
            </div>
      </div>
    </ModalShell>
  );
}
