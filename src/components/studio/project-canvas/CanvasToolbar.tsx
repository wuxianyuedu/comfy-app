"use client";

/** 2026-08-29 T12-3: extracted from ProjectCanvas's floating toolbar
 *  (fit view / export JSON / clear canvas).  Pure presentational.
 */
import { Icon } from "@/components/ui/Icon";

interface CanvasToolbarProps {
  onFitView: () => void;
  onExport: () => void;
  onClear: () => void;
}

const ghostTool =
  "rounded-full px-3 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/6";

export function CanvasToolbar({
  onFitView,
  onExport,
  onClear,
}: CanvasToolbarProps) {
  return (
    <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-linear-to-br from-[#1a1530]/85 to-[#16121f]/85 px-2 py-1.5 shadow-lg shadow-black/30 backdrop-blur-md">
      <span className="flex items-center px-2 text-[11px] font-medium text-violet-200">
        <Icon name="sparkles" size={13} className="mr-1.5" />
        无限画布
      </span>
      <span className="h-4 w-px bg-white/10" />
      <button className={ghostTool} onClick={onFitView}>
        适应视图
      </button>
      <button className={ghostTool} onClick={onExport}>
        导出 JSON
      </button>
      <button className={ghostTool + " hover:text-red-300"} onClick={onClear}>
        清空画布
      </button>
    </div>
  );
}
