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
