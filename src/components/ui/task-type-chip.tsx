"use client";

import { Badge } from "~/components/ui/badge";
import {
  getWorkflowType,
  normalizeTaskType,
  type WorkflowCategory,
} from "~/lib/workflow/workflow-types";

/**
 * 工作流类型只读标签（`<Badge size="sm" variant="outline">` 薄封装，
 * 规范 §16.2.3 / §12.18 的 P67 治理）。
 *
 * 三档色**刻意保留 Tailwind 字面量**（violet / sky / amber，规范 §3.6.1
 * 类型色例外）：image / video / audio 是「这一类工作流是哪种媒体」的分类
 * 语义，色值本身就是分类锚点、**不是**表面色。改品牌色对它不生效是刻意的
 * ——否则 image 会跟着 primary 漂走，与 `--color-primary` 的「正在运行」
 * 语义混起来。同款先例见 `aurora-background.tsx` / `seed-mode-button.tsx`
 * 在 `scripts/check-theme-colors.cjs` 的 EXEMPT_TABLES 登记。
 *
 * 之前这里是裸 `<span>` 手写胶囊（P67 判据 a 命中）；换成 `<Badge>` 后
 * 复用基元的 `data-slot="badge"` / `useRender` / `focus-visible:*` /
 * icon slot（`has-data-[icon=inline-start]:pl-1.5`）等契约。PR-4 起
 * Badge cva 加了 `size` 轴（default / sm / xs），本件从手抄 `CHIP_SHAPE`
 * 常量迁到 `size="sm"`（h-auto / rounded-md / px-1.5 / py-0.5 /
 * text-[10px] 都在 cva 里给，`font-medium` 是 Badge base 自带）；
 * **只留一条 `OUTLINE_RESET` 顶掉 `variant="outline"` 的 `border-border`**
 * （PR-1 时 CHIP_SHAPE 里也带这条、职责不变）。
 */
const CATEGORY_STYLES: Record<WorkflowCategory, { bg: string; text: string }> =
  {
    image: {
      bg: "bg-violet-500/12",
      text: "text-violet-700 dark:text-violet-300",
    },
    video: { bg: "bg-sky-500/12", text: "text-sky-700 dark:text-sky-300" },
    audio: {
      bg: "bg-amber-500/12",
      text: "text-amber-700 dark:text-amber-300",
    },
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
      size="sm"
      variant="outline"
      className={`${OUTLINE_RESET} ${styles.bg} ${styles.text}`}
      title={def?.description ?? label}
    >
      {label}
    </Badge>
  );
}
