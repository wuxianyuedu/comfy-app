"use client";

/** 画布的浮动工具栏（适应视图 / 导出 JSON / 清空画布），纯展示。 */
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";

interface CanvasToolbarProps {
  onFitView: () => void;
  onExport: () => void;
  onClear: () => void;
}

/** 悬浮工具条上的三个文字动作共用同一套「幽灵」外观。 */
const ghostTool =
  "text-ink-soft hover:bg-subtle h-auto rounded-full px-3 py-1 text-xs font-normal transition-colors";

export function CanvasToolbar({
  onFitView,
  onExport,
  onClear,
}: CanvasToolbarProps) {
  return (
    <div className="border-border-strong bg-panel/85 shadow-shadow-strong z-canvas-ui absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1.5 shadow-lg backdrop-blur-md">
      <span className="text-primary-strong text-2xs flex items-center px-2 font-medium">
        <Icon name="sparkles" size={13} className="mr-1.5" />
        无限画布
      </span>
      <span className="bg-border-strong h-4 w-px" />
      <Button variant="ghost" className={ghostTool} onClick={onFitView}>
        适应视图
      </Button>
      <Button variant="ghost" className={ghostTool} onClick={onExport}>
        导出 JSON
      </Button>
      <Button
        variant="ghost"
        className={ghostTool + " hover:text-red-700 dark:hover:text-red-300"}
        onClick={onClear}
      >
        清空画布
      </Button>
    </div>
  );
}
