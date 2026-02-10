import React, { useMemo, useState } from 'react';

type Step = { title: string; body: string };

const STORAGE_KEY = 'ai_data_onboarding_done_v2';

const steps: Step[] = [
  { title: '选择数据源', body: '你可以直接连接数据库（MySQL / PostgreSQL / SQLite）执行 SELECT 查询，或上传 CSV / Excel 文件。' },
  { title: '把数据加入“会话”', body: '数据库：写好 SQL 后点击“执行并加入数据表”。文件：选择文件后点击上传。系统会自动创建会话并保存数据表列表。' },
  { title: '预览与校验', body: '建议先做小范围预览：数据库用 LIMIT 10，文件看前几行。遇到报错会给出“提示”和“错误编号”，方便定位数据问题。' },
  { title: '让 AI 生成分析与看板', body: '在右侧输入你的目标：例如“生成销售分析看板”，AI 会基于会话内所有数据表生成图表与结论。' },
  { title: '编辑与导出', body: '看板支持调整图表样式，并可导出 PNG / PDF / Excel，方便分享与沉淀报告。' },
];

export default function OnboardingTour() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [index, setIndex] = useState(0);
  const step = useMemo(() => steps[index] || steps[0], [index]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
      >
        新手引导
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">快速上手</div>
              <div className="text-xs text-gray-500">{index + 1} / {steps.length}</div>
            </div>
            <button onClick={close} className="text-sm text-gray-600 hover:text-gray-900">
              关闭
            </button>
          </div>

          <div className="p-5 space-y-3">
            <div className="text-lg font-semibold text-gray-900">{step.title}</div>
            <div className="text-sm text-gray-700 leading-relaxed">{step.body}</div>
          </div>

          <div className="px-5 py-4 border-t flex items-center justify-between gap-3">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
            >
              上一步
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={close}
                className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                跳过
              </button>
              <button
                onClick={() => {
                  if (index >= steps.length - 1) close();
                  else setIndex((i) => Math.min(steps.length - 1, i + 1));
                }}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {index >= steps.length - 1 ? '完成' : '下一步'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
