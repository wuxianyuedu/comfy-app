import type { ReactNode } from "react";

export function EmptyStateHint({ emptyHint }: { emptyHint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-subtle px-3 py-3 text-[11px] leading-relaxed text-ink-soft">
      {emptyHint ?? (
        <>
          该工作流尚未标记对外参数。
          <br />
          打开工作流编辑器 → 顶栏「IO 编辑」→ 勾选想要暴露的输入/输出，保存后这里会自动出现对应的表单。
        </>
      )}
    </div>
  );
}
