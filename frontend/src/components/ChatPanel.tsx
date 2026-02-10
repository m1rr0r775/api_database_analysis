import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { formatApiError } from '../apiError';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import type { DashboardChart } from './Dashboard';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  sessionId: string | null;
  selectedFileIds: string[];
  onAddChart: (chart: DashboardChart) => void;
  onSetDashboard: (title: string, charts: DashboardChart[]) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ sessionId, selectedFileIds, onAddChart, onSetDashboard }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! Upload a file and ask me anything about your data.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;
    const key = `chat_history_${sessionId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setMessages([{ role: 'assistant', content: 'Hello! Upload a file and ask me anything about your data.' }]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setMessages(parsed);
      } else {
        setMessages([{ role: 'assistant', content: 'Hello! Upload a file and ask me anything about your data.' }]);
      }
    } catch {
      setMessages([{ role: 'assistant', content: 'Hello! Upload a file and ask me anything about your data.' }]);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const key = `chat_history_${sessionId}`;
    try {
      localStorage.setItem(key, JSON.stringify(messages.slice(-50)));
    } catch {
    }
  }, [sessionId, messages]);

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await axios.post('/api/analyze/', {
        session_id: sessionId,
        file_ids: selectedFileIds,
        query: userMessage,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      });

      const answer = String(response.data.answer || '');
      setMessages(prev => [...prev, { role: 'assistant', content: answer }]);

      if (response.data.dashboard?.charts?.length) {
        const title = String(response.data.dashboard.title || '');
        const charts = (response.data.dashboard.charts as any[]).map((c) => ({
          id: String(c.id || crypto.randomUUID()),
          title: String(c.title || ''),
          option: c.option,
          table: String(c.table || ''),
        }));
        onSetDashboard(title, charts);
      } else if (response.data.need_chart && response.data.chart_option) {
        const option = response.data.chart_option;
        const chartTitle =
          (option?.title && (Array.isArray(option.title) ? option.title[0]?.text : option.title?.text)) || '图表';
        onAddChart({
          id: crypto.randomUUID(),
          title: String(chartTitle || '图表'),
          option,
        });
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: 'assistant', content: formatApiError(error, '分析失败') }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-gray-500 bg-gray-50 border-l">
        <p className="text-center">请先上传一个或多个文件，再开始分析。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-l shadow-lg w-full max-w-md">
      <div className="p-4 border-b bg-gray-50 flex items-center gap-2">
        <Bot className="w-5 h-5 text-blue-600" />
        <h2 className="font-semibold text-gray-700">AI Data Assistant</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <React.Fragment key={idx}>
            <div
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 
                ${msg.role === 'user' ? 'bg-blue-100' : 'bg-green-100'}`}>
                {msg.role === 'user' ? <User className="w-5 h-5 text-blue-600" /> : <Bot className="w-5 h-5 text-green-600" />}
              </div>
              <div className={`p-3 rounded-lg max-w-[85%] text-sm whitespace-pre-wrap
                ${msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-gray-100 text-gray-800 rounded-tl-none'}`}>
                {msg.content}
              </div>
            </div>
          </React.Fragment>
        ))}
        {loading && (
          <div className="flex gap-3">
             <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
               <Bot className="w-5 h-5 text-green-600" />
             </div>
             <div className="bg-gray-100 p-3 rounded-lg rounded-tl-none">
               <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about your data..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
