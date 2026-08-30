"use client";

/** 2026-08-29 T12-3: extracted from WorkflowLibrary's page-header JSX
 *  (title / description / import button / node settings).  Search moved to
 *  the left list panel in the new split layout.
 */
import { CustomNodesSettings } from "@/components/workflow-canvas/CustomNodesSettings";

interface WorkflowLibraryHeaderProps {
  onToggleImport: () => void;
}

export function WorkflowLibraryHeader({
  onToggleImport,
}: WorkflowLibraryHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 px-5 py-4">
      <div>
        <h1 className="font-title text-lg font-bold text-gray-100">工作流库</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          导入本机 ComfyUI 的自定义工作流：支持「导出(API
          格式)」与「导出(工作流格式)」两种 JSON。
          <span className="ml-1 text-cyan-300/80">
            本地工作流请在「自定义节点 / 本地工作流」中配置目录后自动载入。
          </span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleImport}
          className="btn-gradient rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:shadow-violet-500/30"
        >
          ＋ 导入工作流
        </button>
        <CustomNodesSettings />
      </div>
    </div>
  );
}
