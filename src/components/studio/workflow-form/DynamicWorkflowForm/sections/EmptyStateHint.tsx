import type { ReactNode } from "react";

import { EmptyState } from "~/components/ui/empty-state";

/** 该工作流没有对外参数时的默认引导文案（规范 10.5：说清为什么是空的、下一步做什么）。 */
const DEFAULT_HINT = (
  <>
    该工作流尚未标记对外参数。
    <br />
    打开工作流编辑器 → 顶栏「IO 编辑」→
    勾选想要暴露的输入/输出，保存后这里会自动出现对应的表单。
  </>
);

export function EmptyStateHint({ emptyHint }: { emptyHint?: ReactNode }) {
  return <EmptyState variant="hint" description={emptyHint ?? DEFAULT_HINT} />;
}
