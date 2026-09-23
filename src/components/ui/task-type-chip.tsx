"use client";

import { Badge } from "~/components/ui/badge";
import {
  getWorkflowType,
  normalizeTaskType,
  type WorkflowCategory,
} from "~/lib/workflow/workflow-types";

/**
 * 工作流类型只读标签（`<Badge>` 薄封装，规范 §16.2.3 / §12.18 的 P67 治理）。
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
 * icon slot（`has-data-[icon=inline-start]:pl-1.5`）等契约，`className`
 * 只覆盖**尺寸形态**（h-auto / rounded-md / px / py / text-[10px]）
 * 与**类型色例外**两档，不动 Badge 的 variant 逻辑。
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

/** Badge 默认的 `h-5 / rounded-4xl / px-2 / text-xs` 是通用胶囊形态；
 *  本 chip 是**密集行内元信息**（工作流库列表 / 详情头 / 画布节点头），
 *  尺寸要更紧一档——只覆盖 layout 类（尺寸/圆角/内边距），不覆盖色/字重
 *  （规范 shadcn styling.md：`className` for layout, not styling）。 */
const CHIP_SHAPE =
  "h-auto rounded-md border-transparent px-1.5 py-0.5 text-[10px] font-medium";

export function TaskTypeChip({ taskType }: { taskType?: string | null }) {
  const code = normalizeTaskType(taskType ?? "");
  const def = getWorkflowType(code);
  const label = (def?.label ?? code) || "未选";
  const category = def?.category ?? "image";
  const styles = CATEGORY_STYLES[category];

  return (
    <Badge
      variant="outline"
      className={`${CHIP_SHAPE} ${styles.bg} ${styles.text}`}
      title={def?.description ?? label}
    >
      {label}
    </Badge>
  );
}
