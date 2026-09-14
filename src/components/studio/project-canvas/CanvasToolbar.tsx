"use client";

/** extracted from ProjectCanvas's floating toolbar
 *  (fit view / export JSON / clear canvas).  Pure presentational.
 */
import { Icon } from "@/components/ui/icon";

interface CanvasToolbarProps {
  onFitView: () => void;
  onExport: () => void;
  onClear: () => void;
}

const ghostTool =
  "text-ink-soft hover:bg-subtle rounded-full px-3 py-1 text-[12px] transition-colors";

export function CanvasToolbar({
  onFitView,
  onExport,
  onClear,
}: CanvasToolbarProps) {
  return (
    <div className="border-border-strong absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-linear-to-br from-subtle to-surface-20]/85 to-[#16121f]/85 px-2 py-1.5 shadow-lg shadow-black/30 backdrop-blur-md">
      <span className="flex items-center px-2 text-[11px] font-medium text-violet-200">
        <Icon name="sparkles" size={13} className="mr-1.5" />
        无限画布
      </span>
      <span className="bg-border-strong h-4 w-px" />
      <button className={ghostTool} onClick={onFitView}>
        适应视图
      </button>
      <button className={ghostTool} onClick={onExport}>
        导出 JSON
      </button>
      <button className={ghostTool + " hover:text-red-700 dark:text-red-300"} onClick={onClear}>
        清空画布
      </button>
    </div>
  );
}
