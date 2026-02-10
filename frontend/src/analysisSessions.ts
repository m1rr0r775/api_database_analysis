import type { DashboardChart } from './components/Dashboard';
import type { ThemeName } from './components/theme';

export type AnalysisSessionRecord = {
  id: string;
  sessionId: string;
  createdAt: number;
  title: string;
  dashboardTitle: string;
  dashboardCharts: DashboardChart[];
  theme: ThemeName;
  selectedFileIds: string[];
  activeFileId: string | null;
  fileNames: string[];
};

const STORAGE_KEY = 'analysis_sessions_v1';

export function loadAnalysisSessions(): AnalysisSessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as AnalysisSessionRecord[];
  } catch {
    return [];
  }
}

export function saveAnalysisSessions(next: AnalysisSessionRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 50)));
  } catch {}
}

export function upsertAnalysisSession(record: AnalysisSessionRecord) {
  const list = loadAnalysisSessions();
  const filtered = list.filter((x) => x && x.sessionId !== record.sessionId);
  saveAnalysisSessions([record, ...filtered]);
}

export function deleteAnalysisSession(sessionId: string) {
  const list = loadAnalysisSessions();
  saveAnalysisSessions(list.filter((x) => x && x.sessionId !== sessionId));
}

export function deleteLocalChatHistory(sessionId: string) {
  try {
    localStorage.removeItem(`chat_history_${sessionId}`);
  } catch {}
}

