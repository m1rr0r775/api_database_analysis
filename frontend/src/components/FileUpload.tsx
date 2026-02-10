import React, { useState } from 'react';
import axios from 'axios';
import { formatApiError } from '../apiError';

interface FileUploadProps {
  sessionId: string | null;
  onUploaded: (sessionId: string, files: any[]) => void;
  onSessionCreated: (sessionId: string) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ sessionId, onUploaded, onSessionCreated }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smartClean, setSmartClean] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [options, setOptions] = useState({
    remove_mapping_row: true,
    flatten_multilevel_header: true,
    strip_header_whitespace: true,
    drop_empty_rows_cols: true,
    convert_excel_dates: true,
    convert_numeric: true,
    convert_epoch_timestamps: true,
    numeric_columns: [] as string[],
    timestamp_columns: [] as string[],
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
      setError(null);
    }
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const res = await axios.post('/api/sessions/');
    onSessionCreated(res.data.session_id);
    return res.data.session_id as string;
  };

  const handleUpload = async () => {
    if (!files.length) {
      setError("Please select a file first.");
      return;
    }

    setLoading(true);

    try {
      const sid = await ensureSession();
      const formData = new FormData();
      for (const f of files) {
        formData.append("files", f);
      }

      const response = await axios.post(`/api/sessions/${sid}/files/`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        params: {
          smart_clean: smartClean,
          clean_options: JSON.stringify(options),
        },
      });
      
      onUploaded(response.data.session_id, response.data.files);
      setFiles([]);
    } catch (err: any) {
      console.error(err);
      setError(formatApiError(err, 'Failed to upload file.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-semibold mb-4">Upload Data File</h2>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={smartClean} onChange={(e) => setSmartClean(e.target.checked)} />
            智能数据整理
          </label>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            高级设置
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {smartClean
            ? '上传后自动清理列名空格、空行/空列、多级表头、字段映射行，并生成数据质量报告。'
            : '关闭后将尽量按原始结构读取（不做额外整理）。'}
        </div>

        {showAdvanced && (
          <div className="p-3 rounded border bg-gray-50 space-y-2 text-sm text-gray-700">
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
            ).map(([key, label]) => (
              <label key={String(key)} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!options[key]}
                  onChange={(e) => setOptions((p) => ({ ...p, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
            <div className="pt-2 border-t">
              <div className="text-xs text-gray-500 mb-2">
                仅上传阶段可用：手动指定自动转换的列名（逗号分隔）。留空表示自动识别。
              </div>
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
        )}

        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
        <button
          onClick={handleUpload}
          disabled={!files.length || loading}
          className={`py-2 px-4 rounded font-bold text-white transition-colors
            ${!files.length || loading 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {loading ? 'Uploading...' : 'Upload & Analyze'}
        </button>
        {error && (
          <div className="text-red-500 text-sm mt-2">{error}</div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
