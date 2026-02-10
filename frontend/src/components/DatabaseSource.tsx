import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { formatApiError } from '../apiError';

type DbKind = 'mysql' | 'postgres' | 'sqlite';

type DbConnection = {
  id: string;
  name: string;
  kind: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  sqlite_path?: string | null;
  created_at?: number;
};

interface DatabaseSourceProps {
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onUploaded: (sessionId: string, files: any[]) => void;
}

export default function DatabaseSource({ sessionId, onSessionCreated, onUploaded }: DatabaseSourceProps) {
  const [connections, setConnections] = useState<DbConnection[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [sql, setSql] = useState('select 1 as ok');
  const [preview, setPreview] = useState<{ columns: string[]; preview: any[]; row_count: number } | null>(null);
  const [schema, setSchema] = useState<{ tables: Array<{ name: string; schema?: string | null; columns: any[] }> } | null>(null);
  const [savedQueries, setSavedQueries] = useState<Array<{ id: string; name: string; sql: string }>>([]);
  const [history, setHistory] = useState<Array<{ created_at: number; sql: string; row_count: number }>>([]);
  const [saveName, setSaveName] = useState('');

  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    kind: 'mysql' as DbKind,
    host: '127.0.0.1',
    port: 3306,
    database: '',
    username: '',
    password: '',
    sqlite_path: '',
  });

  const activeConn = useMemo(() => connections.find((c) => c.id === activeId) || null, [connections, activeId]);

  const loadConnections = async () => {
    const res = await axios.get('/api/db/connections/');
    const list = (res.data?.connections || []) as DbConnection[];
    setConnections(list);
    if (!activeId && list.length) setActiveId(list[0].id);
    if (activeId && !list.some((c) => c.id === activeId)) setActiveId(list[0]?.id || '');
  };

  useEffect(() => {
    loadConnections().catch(() => {});
  }, []);

  const refreshMeta = async (cid: string) => {
    const [s, q, h] = await Promise.all([
      axios.get(`/api/db/connections/${cid}/schema/`).catch(() => null),
      axios.get(`/api/db/connections/${cid}/queries/`).catch(() => null),
      axios.get(`/api/db/connections/${cid}/history/`).catch(() => null),
    ]);
    if (s?.data) setSchema(s.data);
    if (q?.data?.queries) setSavedQueries(q.data.queries);
    if (h?.data?.history) setHistory(h.data.history);
  };

  useEffect(() => {
    if (!activeId) return;
    refreshMeta(activeId).catch(() => {});
  }, [activeId]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const res = await axios.post('/api/sessions/');
    onSessionCreated(res.data.session_id);
    return res.data.session_id as string;
  };

  const testConnection = async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.post(`/api/db/connections/${activeId}/test/`);
      setMessage('连接测试成功');
    } catch (e: any) {
      setError(formatApiError(e, '连接测试失败'));
    } finally {
      setLoading(false);
    }
  };

  const runPreview = async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await axios.post(`/api/db/connections/${activeId}/query/`, { sql, limit: 200 });
      setPreview(res.data);
      await refreshMeta(activeId);
      setMessage('预览已更新');
    } catch (e: any) {
      setError(formatApiError(e, '查询失败'));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentQuery = async () => {
    if (!activeId) return;
    const name = saveName.trim() || '未命名查询';
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.post(`/api/db/connections/${activeId}/queries/`, { name, sql });
      setSaveName('');
      await refreshMeta(activeId);
      setMessage('查询已保存');
    } catch (e: any) {
      setError(formatApiError(e, '保存失败'));
    } finally {
      setLoading(false);
    }
  };

  const deleteSaved = async (id: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.delete(`/api/db/queries/${id}/`);
      await refreshMeta(activeId);
      setMessage('已删除');
    } catch (e: any) {
      setError(formatApiError(e, '删除失败'));
    } finally {
      setLoading(false);
    }
  };

  const addToSession = async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const sid = await ensureSession();
      const res = await axios.post(`/api/sessions/${sid}/db_query/`, {
        connection_id: activeId,
        sql,
        name: activeConn?.name || 'db_query',
      });
      onUploaded(res.data.session_id, res.data.files || []);
      setMessage('已加入数据表');
    } catch (e: any) {
      setError(formatApiError(e, '执行失败'));
    } finally {
      setLoading(false);
    }
  };

  const createNew = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const payload: any = { name: form.name, kind: form.kind };
      if (form.kind === 'sqlite') {
        payload.sqlite_path = form.sqlite_path;
      } else {
        payload.host = form.host;
        payload.port = form.port;
        payload.database = form.database;
        payload.username = form.username;
        payload.password = form.password;
      }
      const res = await axios.post('/api/db/connections/', payload);
      const conn = res.data?.connection as DbConnection;
      setOpenCreate(false);
      setForm((prev) => ({ ...prev, name: '', database: '', username: '', password: '' }));
      await loadConnections();
      if (conn?.id) setActiveId(conn.id);
      setMessage('连接已保存');
    } catch (e: any) {
      setError(formatApiError(e, '保存失败'));
    } finally {
      setLoading(false);
    }
  };

  const removeConn = async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await axios.delete(`/api/db/connections/${activeId}/`);
      await loadConnections();
      setMessage('连接已删除');
    } catch (e: any) {
      setError(formatApiError(e, '删除失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-xl font-semibold">数据库数据源</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpenCreate(true)}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            新建连接
          </button>
          <button
            onClick={testConnection}
            disabled={!activeId || loading}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            测试连接
          </button>
          <button
            onClick={removeConn}
            disabled={!activeId || loading}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            删除连接
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select
          value={activeId}
          onChange={(e) => setActiveId(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm flex-1"
        >
          <option value="">请选择连接</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.kind})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-gray-700">SQL（仅允许 SELECT/CTE）</div>
        <div className="border rounded-lg overflow-hidden">
          <Editor
            height="220px"
            defaultLanguage="sql"
            value={sql}
            onChange={(v) => setSql(v || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runPreview}
            disabled={!activeId || loading}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            预览查询
          </button>
          <button
            onClick={addToSession}
            disabled={!activeId || loading}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            执行并加入数据表
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="保存为（名称）"
            className="flex-1 px-3 py-2 border rounded-lg text-sm"
          />
          <button
            onClick={saveCurrentQuery}
            disabled={!activeId || loading}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            保存查询
          </button>
        </div>
      </div>

      {message ? <div className="text-sm text-green-700 mt-3">{message}</div> : null}
      {error ? <div className="text-sm text-red-600 mt-3">{error}</div> : null}

      {preview ? (
        <div className="mt-4">
          <div className="text-sm text-gray-700 mb-2">预览（最多 200 行）</div>
          <div className="overflow-x-auto max-h-[260px] border rounded">
            <table className="min-w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c} className="px-4 py-2 whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(preview.preview || []).map((row: any, idx: number) => (
                  <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                    {preview.columns.map((c) => (
                      <td key={c} className="px-4 py-2 whitespace-nowrap">
                        {String(row?.[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 mt-2">返回行数：{preview.row_count}</div>
        </div>
      ) : null}

      {activeId ? (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 text-sm font-medium text-gray-700 border-b">表结构</div>
            <div className="p-3 max-h-[260px] overflow-auto text-sm">
              {!schema?.tables?.length ? (
                <div className="text-gray-500">暂无表结构（或连接不支持）</div>
              ) : (
                <div className="space-y-3">
                  {schema.tables.slice(0, 80).map((t) => (
                    <div key={`${t.schema || ''}.${t.name}`} className="border rounded p-2">
                      <div className="font-medium text-gray-800">
                        {t.schema ? `${t.schema}.` : ''}
                        {t.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {(t.columns || []).slice(0, 16).map((c: any) => (
                          <span key={c.name} className="whitespace-nowrap">
                            {c.name}:{String(c.type || '')}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => setSql((prev) => (prev ? `${prev}\n` : '') + `select * from ${t.name} limit 100`)}
                          className="px-2 py-1 text-xs border rounded"
                        >
                          插入SELECT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 text-sm font-medium text-gray-700 border-b">保存的查询 / 历史</div>
            <div className="p-3 max-h-[260px] overflow-auto text-sm space-y-4">
              <div>
                <div className="text-xs text-gray-500 mb-2">保存的查询</div>
                {!savedQueries.length ? (
                  <div className="text-gray-500">暂无</div>
                ) : (
                  <div className="space-y-2">
                    {savedQueries.slice(0, 20).map((q) => (
                      <div key={q.id} className="border rounded p-2 flex items-start justify-between gap-2">
                        <button onClick={() => setSql(q.sql)} className="text-left flex-1 min-w-0">
                          <div className="font-medium text-gray-800 truncate">{q.name}</div>
                          <div className="text-xs text-gray-500 truncate">{q.sql}</div>
                        </button>
                        <button
                          onClick={() => deleteSaved(q.id)}
                          disabled={loading}
                          className="px-2 py-1 text-xs border rounded disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-2">最近历史（预览查询会记录）</div>
                {!history.length ? (
                  <div className="text-gray-500">暂无</div>
                ) : (
                  <div className="space-y-2">
                    {history.slice(0, 15).map((h, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSql(h.sql)}
                        className="w-full text-left border rounded p-2 hover:bg-gray-50"
                      >
                        <div className="text-xs text-gray-500 truncate">rows={h.row_count}</div>
                        <div className="text-xs text-gray-700 truncate">{h.sql}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {openCreate ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpenCreate(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b flex items-center justify-between">
                <div className="font-semibold text-gray-900">新建数据库连接</div>
                <button onClick={() => setOpenCreate(false)} className="text-sm text-gray-600 hover:text-gray-900">
                  关闭
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="连接名称（可选）"
                    className="col-span-2 px-3 py-2 border rounded-lg text-sm"
                  />
                  <label className="text-sm text-gray-700 flex items-center gap-2 col-span-2">
                    类型
                    <select
                      value={form.kind}
                      onChange={(e) => {
                        const k = e.target.value as DbKind;
                        setForm((p) => ({
                          ...p,
                          kind: k,
                          port: k === 'postgres' ? 5432 : k === 'mysql' ? 3306 : p.port,
                        }));
                      }}
                      className="px-3 py-2 border rounded-lg text-sm flex-1"
                    >
                      <option value="mysql">MySQL</option>
                      <option value="postgres">PostgreSQL</option>
                      <option value="sqlite">SQLite</option>
                    </select>
                  </label>
                </div>

                {form.kind === 'sqlite' ? (
                  <input
                    value={form.sqlite_path}
                    onChange={(e) => setForm((p) => ({ ...p, sqlite_path: e.target.value }))}
                    placeholder="SQLite 文件路径（绝对路径或 data/ 下相对路径）"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={form.host}
                      onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
                      placeholder="Host"
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value) }))}
                      placeholder="Port"
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      value={form.database}
                      onChange={(e) => setForm((p) => ({ ...p, database: e.target.value }))}
                      placeholder="Database"
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      value={form.username}
                      onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder="Username"
                      className="px-3 py-2 border rounded-lg text-sm"
                    />
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Password"
                      className="col-span-2 px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                )}
              </div>
              <div className="px-5 py-4 border-t flex justify-end gap-2">
                <button
                  onClick={() => setOpenCreate(false)}
                  className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={createNew}
                  disabled={loading || !form.kind}
                  className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
