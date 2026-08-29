"use client";

/** 2026-08-29 T12-3: extracted from WorkflowLibrary's page-header JSX
 *  (title / description / search box / import button / node settings).
 */
import { CustomNodesSettings } from "@/components/workflow-canvas/CustomNodesSettings";

interface WorkflowLibraryHeaderProps {
  q: string;
  onQChange: (v: string) => void;
  onToggleImport: () => void;
}

export function WorkflowLibraryHeader({
  q,
  onQChange,
  onToggleImport,
}: WorkflowLibraryHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-title text-xl font-bold text-gray-100">工作流库</h1>
        <p className="mt-1 text-sm text-gray-500">
          导入本机 ComfyUI 的自定义工作流：支持「导出(API
          格式)」与「导出(工作流格式)」两种
          JSON；原始格式会保留节点坐标，画布布局与你 ComfyUI 中看到的一致。
          <span className="ml-1 text-cyan-300/80">
            · 本地工作流请在「自定义节点 / 本地工作流」中配置目录后自动载入。
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(event) => onQChange(event.target.value)}
          placeholder="搜索工作流名称…"
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40 sm:w-56"
        />
        <button
          type="button"
          onClick={onToggleImport}
          className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
        >
          ＋ 导入工作流
        </button>
        <CustomNodesSettings />
      </div>
    </div>
  );
}
