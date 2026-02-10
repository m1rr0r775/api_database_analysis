import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatApiError } from '../apiError';
import ModalShell from './ModalShell';

type SheetMeta = { index: number; name: string; row_count: number; col_count: number; is_empty: boolean };

export default function MultiSheetModal(props: {
  open: boolean;
  sessionId: string;
  workbookFile: any;
  onClose: () => void;
  onExtracted: (files: any[]) => void;
}) {
  const { open, sessionId, workbookFile, onClose, onExtracted } = props;
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [preview, setPreview] = useState<any | null>(null);
  const [smartClean, setSmartClean] = useState(true);
  const [stackSimilar, setStackSimilar] = useState(false);
  const [options, setOptions] = useState({
    remove_mapping_row: true,
    flatten_multilevel_header: true,
    strip_header_whitespace: true,
    drop_empty_rows_cols: true,
    convert_excel_dates: true,
    convert_epoch_timestamps: true,
    convert_numeric: true,
    numeric_columns: [] as string[],
    timestamp_columns: [] as string[],
  });

  const chosenSheets = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  const refreshSheets = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/sessions/${sessionId}/excel/${workbookFile.file_id}/sheets/`);
      const list: SheetMeta[] = res.data.sheets || [];
      setSheets(list.filter((s) => s.index >= 0));
      const initSel: Record<string, boolean> = {};
      for (const s of list) {
        if (s.index < 0) continue;
        initSel[s.name] = !s.is_empty;
      }
      setSelected(initSel);
      const first = list.find((s) => s.index >= 0)?.name || '';
      setActiveSheet(first);
    } catch (e: any) {
      setError(formatApiError(e, '读取Sheet列表失败'));
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (sheetName: string) => {
    if (!sheetName) return;
    setError(null);
    try {
      const res = await axios.post(`/api/sessions/${sessionId}/excel/${workbookFile.file_id}/preview/`, {
        sheet: sheetName,
        smart_clean: smartClean,
        options,
      });
      setPreview(res.data);
    } catch (e: any) {
      setError(formatApiError(e, 'Sheet预览失败'));
    }
  };

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setSheets([]);
    setSelected({});
    setActiveSheet('');
    setError(null);
    refreshSheets().catch(() => {});
  }, [open, workbookFile?.file_id]);

  useEffect(() => {
    if (!open) return;
    if (!activeSheet) return;
    loadPreview(activeSheet).catch(() => {});
  }, [activeSheet, smartClean, options]);

  if (!open) return null;

  return (
    <ModalShell
      open={open}
      title="多Sheet管理"
      subtitle={workbookFile.filename}
      onClose={onClose}
      maxWidthClassName="max-w-6xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            已选择 {chosenSheets.length} 个Sheet{stackSimilar ? '（将自动识别结构相似Sheet并堆叠）' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm border rounded hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={async () => {
                setExtracting(true);
                setError(null);
                try {
                  const res = await axios.post(`/api/sessions/${sessionId}/excel/${workbookFile.file_id}/extract/`, {
                    sheets: chosenSheets,
                    smart_clean: smartClean,
                    options,
                    stack_similar: stackSimilar,
                    add_sheet_column: true,
                  });
                  onExtracted(res.data.files || []);
                  onClose();
                } catch (e: any) {
                  setError(formatApiError(e, '抽取Sheet失败'));
                } finally {
                  setExtracting(false);
                }
              }}
              disabled={!chosenSheets.length || extracting}
              className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {extracting ? '抽取中...' : '抽取为数据表'}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-3">
              <div className="p-3 rounded border bg-gray-50 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={smartClean} onChange={(e) => setSmartClean(e.target.checked)} />
                    Sheet级智能整理
                  </label>
                  <button
                    onClick={() => refreshSheets()}
                    disabled={loading}
                    className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    刷新
                  </button>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={stackSimilar} onChange={(e) => setStackSimilar(e.target.checked)} />
                  结构相似Sheet堆叠合并
                </label>
              </div>

              <div className="p-3 rounded border space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800">Sheet列表</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const s of sheets) next[s.name] = true;
                        setSelected(next);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      全选
                    </button>
                    <button
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const s of sheets) next[s.name] = false;
                        setSelected(next);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      全不选
                    </button>
                  </div>
                </div>
                <div className="max-h-[380px] overflow-auto divide-y">
                  {sheets.map((s) => (
                    <div key={s.name} className="py-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!selected[s.name]}
                        onChange={(e) => setSelected((p) => ({ ...p, [s.name]: e.target.checked }))}
                      />
                      <button
                        onClick={() => setActiveSheet(s.name)}
                        className={`flex-1 text-left min-w-0 ${activeSheet === s.name ? 'text-blue-700' : 'text-gray-800'}`}
                      >
                        <div className="truncate font-medium">{s.name}</div>
                        <div className="text-xs text-gray-500">
                          Rows: {s.row_count} | Cols: {s.col_count} {s.is_empty ? ' | 可能为空/模板Sheet' : ''}
                        </div>
                      </button>
                    </div>
                  ))}
                  {!sheets.length && <div className="text-sm text-gray-500 py-6 text-center">暂无Sheet信息</div>}
                </div>
              </div>

              <div className="p-3 rounded border bg-gray-50 space-y-2 text-sm text-gray-700">
                <div className="font-medium">整理选项</div>
                {(
                  [
                    ['remove_mapping_row', '移除首行字段映射行'],
                    ['flatten_multilevel_header', '多级表头扁平化'],
                    ['strip_header_whitespace', '清理列名空格/特殊空白'],
                    ['drop_empty_rows_cols', '删除完全空白行/列'],
                    ['convert_excel_dates', '自动识别并转换日期列'],
                    ['convert_epoch_timestamps', '自动识别并转换时间戳列'],
                    ['convert_numeric', '自动识别并转换数值列'],
                  ] as Array<[keyof typeof options, string]>
                ).map(([k, label]) => (
                  <label key={String(k)} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!options[k]}
                      onChange={(e) => setOptions((p) => ({ ...p, [k]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
                <div className="pt-2 border-t">
                  <div className="text-xs text-gray-500 mb-2">手动指定转换列名（逗号分隔）。留空表示自动识别。</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">数值转换列（numeric_columns）</div>
                      <input
                        value={(options.numeric_columns || []).join(',')}
                        onChange={(e) =>
                          setOptions((p) => ({
                            ...p,
                            numeric_columns: e.target.value
                              .split(',')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          }))
                        }
                        placeholder="例如：付费金额, 成交额"
                        className="w-full text-sm border rounded p-2"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">时间戳列（timestamp_columns）</div>
                      <input
                        value={(options.timestamp_columns || []).join(',')}
                        onChange={(e) =>
                          setOptions((p) => ({
                            ...p,
                            timestamp_columns: e.target.value
                              .split(',')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          }))
                        }
                        placeholder="例如：付费时间戳"
                        className="w-full text-sm border rounded p-2"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

        <div className="col-span-8 space-y-3">
              {!!error && <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>}

              <div className="p-4 rounded border bg-white">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-sm font-medium text-gray-800 truncate">Sheet预览：{activeSheet || '-'}</div>
                  {!!preview?.cleaned?.diagnostics && (
                    <div className="text-sm text-gray-700">
                      评分：<span className="font-semibold">{preview.cleaned.diagnostics.score ?? '-'}</span>
                      <span className="text-gray-400 mx-2">|</span>
                      严重度：{String(preview.cleaned.diagnostics.severity || '')}
                    </div>
                  )}
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-gray-500">修改整理选项后将自动刷新预览。</div>
                  <button
                    onClick={() => loadPreview(activeSheet)}
                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                  >
                    刷新预览
                  </button>
                </div>

                {!!preview?.cleaned?.diagnostics?.warnings?.length && (
                  <div className="mb-3 space-y-2">
                    {preview.cleaned.diagnostics.warnings.map((w: string, i: number) => (
                      <div key={`${w}-${i}`} className="px-3 py-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm">
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="border rounded">
                    <div className="px-3 py-2 text-xs bg-gray-50 border-b text-gray-700">
                      原始（Rows: {preview?.raw?.row_count ?? '-'} | Cols: {preview?.raw?.columns?.length ?? '-'})
                    </div>
                    <div className="overflow-auto max-h-[340px]">
                      <table className="min-w-full text-xs text-left text-gray-500">
                        <thead className="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0">
                          <tr>
                            {(preview?.raw?.columns || []).map((c: string) => (
                              <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(preview?.raw?.preview || []).map((r: any, i: number) => (
                            <tr key={i} className="bg-white border-b">
                              {(preview?.raw?.columns || []).map((c: string) => (
                                <td key={c} className="px-3 py-2 whitespace-nowrap">{r?.[c]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border rounded">
                    <div className="px-3 py-2 text-xs bg-gray-50 border-b text-gray-700">
                      整理后（Rows: {preview?.cleaned?.row_count ?? '-'} | Cols: {preview?.cleaned?.columns?.length ?? '-'})
                    </div>
                    <div className="overflow-auto max-h-[340px]">
                      <table className="min-w-full text-xs text-left text-gray-500">
                        <thead className="text-[11px] text-gray-700 uppercase bg-gray-100 sticky top-0">
                          <tr>
                            {(preview?.cleaned?.columns || []).map((c: string) => (
                              <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(preview?.cleaned?.preview || []).map((r: any, i: number) => (
                            <tr key={i} className="bg-white border-b">
                              {(preview?.cleaned?.columns || []).map((c: string) => (
                                <td key={c} className="px-3 py-2 whitespace-nowrap">{r?.[c]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
      </div>
    </ModalShell>
  );
}
