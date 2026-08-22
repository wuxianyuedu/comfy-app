"use client";

/** 2026-08-22 P4: modal dialogs extracted from WorkflowLibrary's JSX.
 *  UpgradeConfirmModal is the drag-to-upgrade confirmation (R76/R77):
 *  shown after dropping an API-format JSON onto an imported card whose
 *  apiOrigin is still "derived"; confirms before PATCHing `upgradeFromApi`
 *  (graph replaced, rawJson kept). */
import type { PendingUpgrade } from "./workflow-library-actions";

export function UpgradeConfirmModal({
  pendingUpgrade,
  upgrading,
  upgradeErr,
  onCancel,
  onConfirm,
}: {
  pendingUpgrade: PendingUpgrade | null;
  upgrading: boolean;
  upgradeErr: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pendingUpgrade) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      onClick={() => {
        if (upgrading) return;
        onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-[#16161C] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="upgrade-modal-title" className="text-base font-semibold text-white">
              升级为真实 API 格式
            </h3>
            <p className="mt-1 break-words text-sm text-gray-400">
              将工作流「<span className="text-gray-200">{pendingUpgrade.cardName}</span>」的 graph 替换为刚拖入的真实 API（{pendingUpgrade.nodeCount} 个节点）？
            </p>
            <p className="mt-1 text-[11px] text-gray-500">原 rawJson 保留用于查看。</p>
            {upgradeErr && (
              <p className="mt-2 break-words text-[11px] text-red-400">{upgradeErr}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={upgrading}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={upgrading}
            className="rounded-lg bg-cyan-500/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {upgrading ? "升级中…" : "确认升级"}
          </button>
        </div>
      </div>
    </div>
  );
}
