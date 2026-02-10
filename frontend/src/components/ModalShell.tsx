import React from 'react';

type ModalShellProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidthClassName?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export default function ModalShell(props: ModalShellProps) {
  const { open, title, subtitle, onClose, maxWidthClassName, children, footer } = props;
  if (!open) return null;

  const width = maxWidthClassName || 'max-w-6xl';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* header/footer 固定，内容区域独立滚动，避免弹窗过长无法操作 */}
        <div
          className={`w-full ${width} max-h-[90vh] bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">{title}</div>
              {!!subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
            </div>
            <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900">
              关闭
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">{children}</div>

          {!!footer && <div className="px-5 py-4 border-t">{footer}</div>}
        </div>
      </div>
    </>
  );
}
