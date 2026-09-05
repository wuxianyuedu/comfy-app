"use client";

/** extracted from WorkflowLibrary's page-header JSX
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 px-5 py-2.5">
      <div className="flex items-center gap-2">
        <h1 className="font-title text-lg font-bold text-gray-100">工作流库</h1>
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
