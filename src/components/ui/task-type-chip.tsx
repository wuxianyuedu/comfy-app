"use client";

import { Badge } from "~/components/ui/badge";
import {
  getWorkflowType,
  normalizeTaskType,
  type WorkflowCategory,
} from "~/lib/workflow/workflow-types";

/**
 * 工作流类型只读标签（`<Badge size="sm" variant="outline">` 薄封装，规范 §16.2.3 / §12.18）。三档色走状态变量、不写调色板字面量（§3.6.2）：image = 品牌紫、audio = 警告琥珀、video = 信息青（与原先 sky 几乎零像素差）。
 * ⚠️ image 档与品牌紫同色相是有意的：它表达「这类产物是图片」，而「正在运行」由 `StatusDot` / `Badge tone="primary"` 的位置与文案承担，两者不同格出现。要继续解耦应补 `--color-media-*` 两态 token，不是回到写死。Badge cva 加 `size` 轴后迁到 `size="sm"`，只留 `OUTLINE_RESET` 顶掉 `variant="outline"` 的边框。
 */
/** 底色取 `*-soft` 档、字色取 `*-strong` 档（都是两态 token，调用点不必
 *  再手写 `dark:`）：与 `ui/badge.tsx` 的 tone 表同一套「浅底 + 深字」配方。 */
const CATEGORY_STYLES: Record<WorkflowCategory, { bg: string; text: string }> = {
  image: { bg: "bg-primary-soft", text: "text-primary-strong" },
  video: { bg: "bg-info/10", text: "text-info-strong" },
  audio: { bg: "bg-warning-soft", text: "text-warning-strong" },
};

/** `variant="outline"` 会带一条 `border-border`；chip 两档**不想要边框**
 *  （密集行内元信息、色底就够表达语义），用 `border-transparent` 顶掉
 *  （tailwind-merge 后传者胜）。这一条与 `size` 轴无关、留在本地。 */
const OUTLINE_RESET = "border-transparent";

export function TaskTypeChip({ taskType }: { taskType?: string | null }) {
  const code = normalizeTaskType(taskType ?? "");
  const def = getWorkflowType(code);
  const label = (def?.label ?? code) || "未选";
  const category = def?.category ?? "image";
  const styles = CATEGORY_STYLES[category];

  return (
    <Badge
      className={`${OUTLINE_RESET} ${styles.bg} ${styles.text}`}
      size="sm"
      title={def?.description ?? label}
      variant="outline"
    >
      {label}
    </Badge>
  );
}
