import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import FileUpload from './components/FileUpload';
import DatabaseSource from './components/DatabaseSource';
import ChatPanel from './components/ChatPanel';
import Dashboard, { DashboardChart } from './components/Dashboard';
import { ThemeName } from './components/theme';
import OnboardingTour from './components/OnboardingTour';
import SmartCleanModal from './components/SmartCleanModal';
import MultiSheetModal from './components/MultiSheetModal';
import ModelerModal from './components/ModelerModal';
import AnalysisHistoryModal from './components/AnalysisHistoryModal';
import {
  AnalysisSessionRecord,
  deleteAnalysisSession,
  deleteLocalChatHistory,
  loadAnalysisSessions,
  upsertAnalysisSession,
} from './analysisSessions';

function App() {
  const DASHBOARD_STORAGE_KEY = 'dashboard_state_v1';
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState<'cleaned' | 'raw'>('cleaned');
  const [cleanOpen, setCleanOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [workbookActive, setWorkbookActive] = useState<any | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [dashboardTitle, setDashboardTitle] = useState<string>('');
  const [dashboardCharts, setDashboardCharts] = useState<DashboardChart[]>([]);
  const [theme, setTheme] = useState<ThemeName>('light');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<AnalysisSessionRecord[]>([]);
  const [chartHistory, setChartHistory] = useState<
    Record<string, { past: Array<{ title: string; option: any }>; future: Array<{ title: string; option: any }> }>
  >({});
  const chartHistoryRef = useRef(chartHistory);
  chartHistoryRef.current = chartHistory;

  const activeFile = files.find((f) => f.file_id === activeFileId) || null;

  useEffect(() => {
    setPreviewMode('cleaned');
  }, [activeFileId]);

  const severityLabel = (v: any) => {
    if (v === 'low') return '低';
    if (v === 'medium') return '中';
    if (v === 'high') return '高';
    return String(v || '');
  };

  const updateFile = (nextFile: any) => {
    setFiles((prev) => prev.map((f) => (f.file_id === nextFile.file_id ? { ...f, ...nextFile } : f)));
  };

  const addFiles = (newFiles: any[]) => {
    if (!newFiles?.length) return;
    setFiles((prev) => [...prev, ...newFiles]);
    if (!activeFileId && newFiles.length) setActiveFileId(newFiles[0].file_id);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.title === 'string') setDashboardTitle(parsed.title);
        if (Array.isArray(parsed.charts)) setDashboardCharts(parsed.charts);
        if (typeof parsed.theme === 'string') setTheme(parsed.theme as ThemeName);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_STORAGE_KEY,
        JSON.stringify({ title: dashboardTitle, charts: dashboardCharts, theme })
      );
    } catch {}
  }, [dashboardTitle, dashboardCharts, theme]);

  useEffect(() => {
    setHistorySessions(loadAnalysisSessions());
  }, []);

  const snapshotCurrentSession = () => {
    if (!sessionId) return;
    const record: AnalysisSessionRecord = {
      id: crypto.randomUUID(),
      sessionId,
      createdAt: Date.now(),
      title: dashboardTitle || `分析会话 ${sessionId.slice(0, 8)}`,
      dashboardTitle,
      dashboardCharts,
      theme,
      selectedFileIds,
      activeFileId,
      fileNames: (files || []).map((f) => String(f?.filename || '')).filter(Boolean),
    };
    upsertAnalysisSession(record);
    setHistorySessions(loadAnalysisSessions());
  };

  const startNewSession = async () => {
    snapshotCurrentSession();
    const res = await axios.post('/api/sessions/');
    const sid = String(res.data.session_id || '');
    if (!sid) return;
    handleSessionCreated(sid);
  };

  const openHistorySession = async (s: AnalysisSessionRecord) => {
    snapshotCurrentSession();
    setHistoryOpen(false);
    setSessionId(s.sessionId);
    setDashboardTitle(s.dashboardTitle || '');
    setDashboardCharts(Array.isArray(s.dashboardCharts) ? s.dashboardCharts : []);
    setTheme(s.theme || 'light');
    setSelectedFileIds(Array.isArray(s.selectedFileIds) ? s.selectedFileIds : []);
    setActiveFileId(s.activeFileId || null);
    setChartHistory({});

    try {
      const res = await axios.get(`/api/sessions/${s.sessionId}/files/`);
      const list = Array.isArray(res.data.files) ? res.data.files : [];
      setFiles(list);
      if (!s.activeFileId && list.length) setActiveFileId(list[0].file_id);
    } catch {
      setFiles([]);
      setActiveFileId(null);
      setSelectedFileIds([]);
    }
  };

  const deleteHistorySession = (s: AnalysisSessionRecord) => {
    deleteAnalysisSession(s.sessionId);
    deleteLocalChatHistory(s.sessionId);
    setHistorySessions(loadAnalysisSessions());
  };

  const handleSessionCreated = (sid: string) => {
    if (sid !== sessionId) {
      setSessionId(sid);
      setFiles([]);
      setActiveFileId(null);
      setSelectedFileIds([]);
      setDashboardTitle('');
      setDashboardCharts([]);
      setChartHistory({});
    }
  };

  const handleUploaded = (sid: string, newFiles: any[]) => {
    if (!sessionId) setSessionId(sid);
    const merged = [...files, ...newFiles];
    setFiles(merged);
    if (!activeFileId && newFiles.length) setActiveFileId(newFiles[0].file_id);
    const ids = merged.filter((f) => f.kind !== 'excel_workbook').map((f) => f.file_id);
    setSelectedFileIds(ids);
  };

  const toggleSelected = (fileId: string) => {
    setSelectedFileIds((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]));
  };

  const addChart = (chart: DashboardChart) => {
    setDashboardCharts((prev) => [...prev, chart]);
  };

  const setDashboard = (title: string, charts: DashboardChart[]) => {
    setDashboardTitle(title);
    setDashboardCharts(charts);
    setChartHistory({});
  };

  const updateChart = (id: string, patch: Partial<DashboardChart>, opts?: { recordHistory?: boolean }) => {
    const recordHistory = opts?.recordHistory !== false;
    setDashboardCharts((prev) => {
      const current = prev.find((c) => c.id === id);
      if (!current) return prev;
      if (recordHistory) {
        setChartHistory((h) => {
          const st = h[id] || { past: [], future: [] };
          const nextPast = [...st.past, { title: current.title, option: current.option }].slice(-50);
          return { ...h, [id]: { past: nextPast, future: [] } };
        });
      }
      return prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
    });
  };

  const canUndoChart = (id: string) => (chartHistory[id]?.past?.length || 0) > 0;
  const canRedoChart = (id: string) => (chartHistory[id]?.future?.length || 0) > 0;

  const undoChart = (id: string) => {
    setDashboardCharts((prev) => {
      const current = prev.find((c) => c.id === id);
      if (!current) return prev;
      const st = chartHistoryRef.current[id];
      if (!st?.past?.length) return prev;
      const last = st.past[st.past.length - 1];
      setChartHistory((h) => {
        const cur = h[id] || { past: [], future: [] };
        const nextPast = cur.past.slice(0, -1);
        const nextFuture = [{ title: current.title, option: current.option }, ...cur.future].slice(0, 50);
        return { ...h, [id]: { past: nextPast, future: nextFuture } };
      });
      return prev.map((c) => (c.id === id ? { ...c, title: last.title, option: last.option } : c));
    });
  };

  const redoChart = (id: string) => {
    setDashboardCharts((prev) => {
      const current = prev.find((c) => c.id === id);
      if (!current) return prev;
      const st = chartHistoryRef.current[id];
      if (!st?.future?.length) return prev;
      const next = st.future[0];
      setChartHistory((h) => {
        const cur = h[id] || { past: [], future: [] };
        const nextPast = [...cur.past, { title: current.title, option: current.option }].slice(-50);
        const nextFuture = cur.future.slice(1);
        return { ...h, [id]: { past: nextPast, future: nextFuture } };
      });
      return prev.map((c) => (c.id === id ? { ...c, title: next.title, option: next.option } : c));
    });
  };

  const reorderCharts = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setDashboardCharts((prev) => {
      const from = prev.findIndex((c) => c.id === fromId);
      const to = prev.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm z-10 p-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-800">AI Data Visualization Dashboard</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => startNewSession().catch(() => {})}
                className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
              >
                新会话（清空分析）
              </button>
              <button onClick={() => setHistoryOpen(true)} className="px-3 py-2 text-sm border rounded hover:bg-gray-50">
                历史
              </button>
              <OnboardingTour />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            <DatabaseSource
              sessionId={sessionId}
              onSessionCreated={handleSessionCreated}
              onUploaded={handleUploaded}
            />
            <FileUpload
              sessionId={sessionId}
              onSessionCreated={handleSessionCreated}
              onUploaded={handleUploaded}
            />

            {!!files.length && (
              <div className="bg-white p-6 rounded-lg shadow-md">
                <div className="flex items-center justify-between mb-4 gap-3">
                  <h2 className="text-xl font-semibold">数据表</h2>
                  <button
                    onClick={() => setModelOpen(true)}
                    disabled={files.filter((f) => f.columns?.length && f.kind !== 'excel_workbook').length < 2}
                    className="px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    数据模型
                  </button>
                </div>
                <div className="space-y-2">
                  {files.map((f) => (
                    <div
                      key={f.file_id}
                      className={`flex items-center justify-between gap-3 p-3 rounded border ${
                        f.file_id === activeFileId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <button
                        onClick={() => setActiveFileId(f.file_id)}
                        className="text-left flex-1 min-w-0"
                      >
                        <div className="font-medium text-gray-800 truncate">{f.filename}</div>
                        <div className="text-xs text-gray-500">
                          {f.kind === 'excel_workbook'
                            ? `Excel 多Sheet | Sheets: ${f.sheets?.length ?? 0}`
                            : `Rows: ${f.row_count} | Cols: ${f.columns?.length ?? 0}`}
                        </div>
                      </button>
                      {f.kind === 'excel_workbook' && !!sessionId && (
                        <button
                          onClick={() => {
                            setWorkbookActive(f);
                            setSheetOpen(true);
                          }}
                          className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                        >
                          Sheet管理
                        </button>
                      )}
                      {f.kind !== 'excel_workbook' && (
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input
                            type="checkbox"
                            checked={selectedFileIds.includes(f.file_id)}
                            onChange={() => toggleSelected(f.file_id)}
                          />
                          联合分析
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeFile && (
              <div className="bg-white p-6 rounded-lg shadow-md animate-fade-in">
                <h2 className="text-xl font-semibold mb-4">Data Preview</h2>
                <div className="bg-gray-50 p-4 rounded border">
                  <div className="flex justify-between items-center mb-4">
                     <div>
                        <p><strong>Filename:</strong> {activeFile.filename}</p>
                        <p className="text-sm text-gray-500">
                          Rows: {previewMode === 'raw' ? activeFile.raw_row_count ?? activeFile.row_count : activeFile.row_count} | Cols:{' '}
                          {previewMode === 'raw' ? activeFile.raw_columns?.length ?? activeFile.columns.length : activeFile.columns.length}
                        </p>
                     </div>
                     {!!activeFile.diagnostics && (
                       <div className="text-right">
                         <div className="text-sm text-gray-700">
                           质量评分：<span className="font-semibold">{activeFile.diagnostics.score ?? '-'}</span>
                         </div>
                         <div className="text-xs text-gray-500">
                           严重程度：{severityLabel(activeFile.diagnostics.severity)}
                         </div>
                       </div>
                     )}
                     {!!sessionId && (
                       <div className="flex items-center gap-2">
                         <button
                           onClick={() => setCleanOpen(true)}
                           className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                         >
                           智能整理
                         </button>
                       </div>
                     )}
                  </div>

                  {!!activeFile.raw_preview?.length && (
                    <div className="mb-4 flex items-center gap-2">
                      <button
                        onClick={() => setPreviewMode('cleaned')}
                        className={`px-3 py-1.5 text-sm rounded border ${
                          previewMode === 'cleaned' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-100'
                        }`}
                      >
                        整理后
                      </button>
                      <button
                        onClick={() => setPreviewMode('raw')}
                        className={`px-3 py-1.5 text-sm rounded border ${
                          previewMode === 'raw' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-100'
                        }`}
                      >
                        原始
                      </button>
                    </div>
                  )}

                  {!!activeFile.diagnostics?.warnings?.length && (
                    <div className="mb-4 space-y-2">
                      {activeFile.diagnostics.warnings.map((w: string, i: number) => (
                        <div
                          key={`${w}-${i}`}
                          className="px-3 py-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm"
                        >
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="min-w-full text-sm text-left text-gray-500">
                      <thead className="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
                        <tr>
                          {(previewMode === 'raw' ? activeFile.raw_columns ?? activeFile.columns : activeFile.columns).map((col: string) => (
                            <th key={col} className="px-6 py-3 whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(previewMode === 'raw' ? activeFile.raw_preview ?? activeFile.preview : activeFile.preview).map(
                          (row: any, idx: number) => (
                          <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                            {(previewMode === 'raw' ? activeFile.raw_columns ?? activeFile.columns : activeFile.columns).map((col: string) => (
                              <td key={col} className="px-6 py-4 whitespace-nowrap">{row[col]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {!!sessionId && !!activeFile && (
              <SmartCleanModal
                open={cleanOpen}
                sessionId={sessionId}
                file={activeFile}
                onClose={() => setCleanOpen(false)}
                onFileUpdated={updateFile}
              />
            )}

            {!!sessionId && !!workbookActive && (
              <MultiSheetModal
                open={sheetOpen}
                sessionId={sessionId}
                workbookFile={workbookActive}
                onClose={() => setSheetOpen(false)}
                onExtracted={addFiles}
              />
            )}

            {!!sessionId && (
              <ModelerModal
                open={modelOpen}
                sessionId={sessionId}
                files={files}
                onClose={() => setModelOpen(false)}
                onCreated={(f) => {
                  addFiles([f]);
                  setActiveFileId(f.file_id);
                }}
              />
            )}

            <Dashboard
              title={dashboardTitle}
              charts={dashboardCharts}
              theme={theme}
              onThemeChange={setTheme}
              onRemoveChart={(id) => setDashboardCharts((prev) => prev.filter((c) => c.id !== id))}
              onUpdateChart={updateChart}
              onReorderCharts={reorderCharts}
              onUndoChart={undoChart}
              onRedoChart={redoChart}
              canUndoChart={canUndoChart}
              canRedoChart={canRedoChart}
              onClear={() => {
                setDashboardTitle('');
                setDashboardCharts([]);
                setChartHistory({});
              }}
            />
          </div>
        </main>
      </div>

      <div className="w-[400px] border-l bg-white h-full shadow-xl z-20">
        <ChatPanel
          sessionId={sessionId}
          selectedFileIds={selectedFileIds}
          onAddChart={addChart}
          onSetDashboard={setDashboard}
        />
      </div>

      <AnalysisHistoryModal
        open={historyOpen}
        sessions={historySessions}
        onClose={() => setHistoryOpen(false)}
        onOpenSession={(s) => openHistorySession(s).catch(() => {})}
        onDeleteSession={deleteHistorySession}
      />
    </div>
  );
}

export default App;
