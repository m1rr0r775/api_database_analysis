import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatApiError } from '../apiError';
import ModalShell from './ModalShell';

type CleanOp = { id: string; name: string; enabled: boolean; severity?: string };

export default function SmartCleanModal(props: {
  open: boolean;
  sessionId: string;
  file: any;
  onClose: () => void;
  onFileUpdated: (file: any) => void;
}) {
  const { open, sessionId, file, onClose, onFileUpdated } = props;
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string>('');
  const [smartClean, setSmartClean] = useState(true);
  const [options, setOptions] = useState<Record<string, any>>({});
  const [ops, setOps] = useState<CleanOp[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  const [view, setView] = useState<'compare' | 'issues'>('compare');
  const [instruction, setInstruction] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [aiSemantics, setAiSemantics] = useState<any | null>(null);

  const effectiveOptions = useMemo(() => {
    const out: Record<string, any> = { ...options };
    for (const o of ops) out[o.id] = !!o.enabled;
    return out;
  }, [options, ops]);

  const refreshTemplates = async () => {
    const res = await axios.get('/api/clean/templates/');
    setTemplates(res.data.templates || []);
  };

  const loadPreview = async (opts?: Record<string, any>) => {
    setLoading(true);
    setError(null);
    try {
      const body = { smart_clean: smartClean, options: opts ?? effectiveOptions, use_learning: true };
      const res = await axios.post(`/api/sessions/${sessionId}/files/${file.file_id}/clean/preview/`, body);
      setPlanId(res.data.plan_id || '');
      setPreview(res.data);
      setOps(res.data.ops || []);
      setOptions(res.data.options || {});
    } catch (e: any) {
      setError(formatApiError(e, '预览整理方案失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSmartClean(true);
    setInstruction('');
    setView('compare');
    setPlanId('');
    setPreview(null);
    setOps([]);
    setOptions({});
    setSelectedTemplateId('');
    setTemplateName('');
    setAiSemantics(null);
    refreshTemplates().catch(() => {});
    loadPreview().catch(() => {});
  }, [open, file?.file_id]);

  if (!open) return null;

  const cleaned = preview?.cleaned;
  const raw = preview?.raw;
  const issues = cleaned?.diagnostics?.issues || [];
  const warnings = cleaned?.diagnostics?.warnings || [];
  const semantics = cleaned?.semantics;
  const columns: string[] = cleaned?.columns || [];

  const parseList = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <ModalShell
      open={open}
      title="智能数据整理"
      subtitle={file.filename}
      onClose={onClose}
      maxWidthClassName="max-w-6xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500 truncate">
            {preview?.recommended_options ? '已根据历史方案学习结果提供默认配置（可调整）。' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setApplying(true);
                setError(null);
                try {
                  const res = await axios.post(`/api/sessions/${sessionId}/files/${file.file_id}/clean/revert/`);
                  onFileUpdated(res.data.file);
                  onClose();
                } catch (e: any) {
                  setError(formatApiError(e, '回退失败'));
                } finally {
                  setApplying(false);
                }
              }}
              disabled={applying || !file.original_path}
              className="px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              回退原始
            </button>
            <button
              onClick={async () => {
                setApplying(true);
                setError(null);
                try {
                  const res = await axios.post(`/api/sessions/${sessionId}/files/${file.file_id}/clean/apply/`, {
                    plan_id: planId,
                    options: effectiveOptions,
                  });
                  onFileUpdated(res.data.file);
                  onClose();
                } catch (e: any) {
                  setError(formatApiError(e, '应用整理失败'));
                } finally {
                  setApplying(false);
                }
              }}
              disabled={applying || !planId}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {applying ? '应用中...' : '确认应用整理'}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-3 space-y-3">
              <div className="p-3 rounded border bg-gray-50 space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={smartClean} onChange={(e) => setSmartClean(e.target.checked)} />
                  启用智能整理
                </label>
                <button
                  onClick={() => loadPreview()}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? '生成中...' : '重新生成方案'}
                </button>
              </div>

              <div className="p-3 rounded border space-y-2">
                <div className="text-sm font-medium text-gray-800">整理步骤（可逐条关闭）</div>
                <div className="space-y-2">
                  {ops.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={!!o.enabled}
                        onChange={(e) =>
                          setOps((prev) => prev.map((x) => (x.id === o.id ? { ...x, enabled: e.target.checked } : x)))
                        }
                      />
                      <span className="truncate">{o.name}</span>
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => loadPreview(effectiveOptions)}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  应用勾选并预览
                </button>
              </div>

              <div className="p-3 rounded border space-y-2">
                <div className="text-sm font-medium text-gray-800">自动转换列</div>
                <div className="text-xs text-gray-500">
                  留空表示自动；填写后仅对这些列生效（逗号分隔，列名需与表中一致）。
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">数值转换列（numeric_columns）</div>
                    <input
                      value={(options.numeric_columns || []).join(',')}
                      onChange={(e) => setOptions((p) => ({ ...p, numeric_columns: parseList(e.target.value) }))}
                      placeholder="例如：付费金额, 成交额"
                      className="w-full text-sm border rounded p-2"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">时间戳列（timestamp_columns）</div>
                    <input
                      value={(options.timestamp_columns || []).join(',')}
                      onChange={(e) => setOptions((p) => ({ ...p, timestamp_columns: parseList(e.target.value) }))}
                      placeholder="例如：付费时间戳"
                      className="w-full text-sm border rounded p-2"
                    />
                  </div>
                </div>
                {!!columns.length && (
                  <div className="text-xs text-gray-500">
                    可用列：{columns.slice(0, 10).join('、')}
                    {columns.length > 10 ? '…' : ''}
                  </div>
                )}
                <button
                  onClick={() => loadPreview(effectiveOptions)}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  应用转换配置并预览
                </button>
              </div>

              <div className="p-3 rounded border space-y-2">
                <div className="text-sm font-medium text-gray-800">自然语言调整</div>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={4}
                  placeholder="例如：不要移除映射行；保留空列；把交叉表转成长表"
                  className="w-full text-sm border rounded p-2"
                />
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      const res = await axios.post('/api/clean/nl/', {
                        instruction,
                        current_options: effectiveOptions,
                      });
                      const next = res.data.options || {};
                      setOptions(next);
                      await loadPreview(next);
                    } catch (e: any) {
                      setError(formatApiError(e, '自然语言调整失败'));
                    }
                  }}
                  disabled={!instruction.trim() || loading}
                  className="w-full px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  让 AI 生成配置
                </button>
              </div>

              <div className="p-3 rounded border space-y-2">
                <div className="text-sm font-medium text-gray-800">模板</div>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full text-sm border rounded p-2"
                >
                  <option value="">选择模板（可选）</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const t = templates.find((x) => x.id === selectedTemplateId);
                      if (!t) return;
                      setOptions(t.options || {});
                      await loadPreview(t.options || {});
                    }}
                    disabled={!selectedTemplateId || loading}
                    className="flex-1 px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    应用模板
                  </button>
                  <button
                    onClick={refreshTemplates}
                    className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                  >
                    刷新
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="模板名"
                    className="flex-1 text-sm border rounded p-2"
                  />
                  <button
                    onClick={async () => {
                      setError(null);
                      try {
                        await axios.post('/api/clean/templates/', { name: templateName, options: effectiveOptions });
                        setTemplateName('');
                        await refreshTemplates();
                      } catch (e: any) {
                        setError(formatApiError(e, '保存模板失败'));
                      }
                    }}
                    disabled={!templateName.trim()}
                    className="px-3 py-2 text-sm bg-gray-900 text-white rounded hover:bg-black disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>

        <div className="col-span-9 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView('compare')}
                    className={`px-3 py-2 text-sm rounded border ${
                      view === 'compare' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'
                    }`}
                  >
                    对比
                  </button>
                  <button
                    onClick={() => setView('issues')}
                    className={`px-3 py-2 text-sm rounded border ${
                      view === 'issues' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'
                    }`}
                  >
                    问题清单
                  </button>
                </div>

                <div className="text-right">
                  {!!cleaned?.diagnostics && (
                    <div className="text-sm text-gray-700">
                      质量评分：<span className="font-semibold">{cleaned.diagnostics.score ?? '-'}</span>
                      <span className="text-gray-400 mx-2">|</span>
                      严重程度：{String(cleaned.diagnostics.severity || '')}
                    </div>
                  )}
                </div>
              </div>

              {!!error && <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>}

              {view === 'issues' && (
                <div className="p-4 rounded border bg-white space-y-2">
                  {!!warnings.length && (
                    <div className="space-y-2">
                      {warnings.map((w: string, i: number) => (
                        <div key={`${w}-${i}`} className="px-3 py-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-sm font-medium text-gray-800">结构化问题</div>
                  <div className="space-y-2">
                    {issues.map((it: any) => (
                      <div key={it.code} className="p-3 rounded border bg-gray-50">
                        <div className="text-sm text-gray-900">
                          {it.message} <span className="text-xs text-gray-500">({it.severity})</span>
                        </div>
                        {!!it.suggestion && <div className="text-xs text-gray-600 mt-1">{it.suggestion}</div>}
                      </div>
                    ))}
                    {!issues.length && <div className="text-sm text-gray-500">未发现明显结构问题。</div>}
                  </div>

                  {!!semantics && (
                    <>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-800">字段语义（规则推断）</div>
                        <button
                          onClick={async () => {
                            setError(null);
                            try {
                              const res = await axios.post('/api/clean/semantic/', {
                                columns: cleaned?.columns || [],
                                sample_rows: cleaned?.preview || [],
                              });
                              setAiSemantics(res.data);
                            } catch (e: any) {
                              setError(formatApiError(e, 'AI 语义理解失败'));
                            }
                          }}
                          className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                        >
                          AI 语义理解
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded border bg-gray-50">
                          <div className="text-gray-500">主键候选</div>
                          <div className="text-gray-900 mt-1">{(semantics.key_candidates || []).slice(0, 8).join('、') || '-'}</div>
                        </div>
                        <div className="p-2 rounded border bg-gray-50">
                          <div className="text-gray-500">度量</div>
                          <div className="text-gray-900 mt-1">{(semantics.measures || []).slice(0, 8).join('、') || '-'}</div>
                        </div>
                        <div className="p-2 rounded border bg-gray-50">
                          <div className="text-gray-500">维度</div>
                          <div className="text-gray-900 mt-1">{(semantics.dimensions || []).slice(0, 8).join('、') || '-'}</div>
                        </div>
                      </div>
                    </>
                  )}

                  {!!aiSemantics && (
                    <div className="mt-3 p-3 rounded border bg-gray-50">
                      <div className="text-sm font-medium text-gray-800">AI 语义理解结果</div>
                      <div className="text-xs text-gray-700 mt-2">
                        主键候选：{(aiSemantics.key_candidates || []).slice(0, 10).join('、') || '-'}
                      </div>
                      <div className="text-xs text-gray-700 mt-1">
                        度量：{(aiSemantics.measures || []).slice(0, 10).join('、') || '-'}
                      </div>
                      <div className="text-xs text-gray-700 mt-1">
                        维度：{(aiSemantics.dimensions || []).slice(0, 10).join('、') || '-'}
                      </div>
                      {!!aiSemantics.relations_hint?.length && (
                        <div className="text-xs text-gray-700 mt-2">
                          关系提示：{aiSemantics.relations_hint.slice(0, 5).join('；')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {view === 'compare' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded border bg-white">
                    <div className="text-sm font-medium text-gray-800 mb-2">
                      原始（Rows: {raw?.row_count ?? '-'} | Cols: {raw?.columns?.length ?? '-'})
                    </div>
                    <div className="overflow-auto max-h-[420px]">
                      <table className="min-w-full text-xs text-left text-gray-500">
                        <thead className="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0">
                          <tr>
                            {(raw?.columns || []).map((c: string) => (
                              <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(raw?.preview || []).map((r: any, i: number) => (
                            <tr key={i} className="bg-white border-b">
                              {(raw?.columns || []).map((c: string) => (
                                <td key={c} className="px-3 py-2 whitespace-nowrap">{r?.[c]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-4 rounded border bg-white">
                    <div className="text-sm font-medium text-gray-800 mb-2">
                      整理后（Rows: {cleaned?.row_count ?? '-'} | Cols: {cleaned?.columns?.length ?? '-'})
                    </div>
                    <div className="overflow-auto max-h-[420px]">
                      <table className="min-w-full text-xs text-left text-gray-500">
                        <thead className="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0">
                          <tr>
                            {(cleaned?.columns || []).map((c: string) => (
                              <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(cleaned?.preview || []).map((r: any, i: number) => (
                            <tr key={i} className="bg-white border-b">
                              {(cleaned?.columns || []).map((c: string) => (
                                <td key={c} className="px-3 py-2 whitespace-nowrap">{r?.[c]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
      </div>
    </ModalShell>
  );
}
