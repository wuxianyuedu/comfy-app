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
 * 三档色**走状态变量而不是调色板字面量**（规范 §3.6.2）：image / video /
 * audio 是「这一类工作流是哪种媒体」的分类语义，但分类语义不等于「可以
 * 写死 `violet-500`」——此前它写的是 `bg-violet-500/12` + `dark:` 那套
 * 手写两态（P71/P79 因 `ui/` 整层豁免而一直没扫到它）。现在每档取一颗
 * 语义族里**色相最接近且不撞状态语义**的：image = 品牌紫、audio = 警告
 * 琥珀、video = 信息青（后者与原来的 sky 同色相，几乎零像素差）。
 *
 * ⚠️ **image 档与品牌紫同色相是有意的**：它表达的是「这类产物是图片」，
 * 而「正在运行」那件事由 `StatusDot` / `Badge tone="primary"` 的**位置与
 * 文案**承担，两者不在同一格出现。要继续把 image 与品牌解耦，做法是补
 * `--color-media-image|video|audio` 三颗**两态**类型色 token（与端口类型
 * 色同族），不是回到写死字面量。
 *
 * 之前这里是裸 `<span>` 手写胶囊（P67 判据 a 命中）；换成 `<Badge>` 后
 * 复用基元的 `data-slot="badge"` / `useRender` / `focus-visible:*` /
 * icon slot（`has-data-[icon=inline-start]:pl-1.5`）等契约。PR-4 起
 * Badge cva 加了 `size` 轴（default / sm / xs），本件从手抄 `CHIP_SHAPE`
 * 常量迁到 `size="sm"`（h-auto / rounded-md / px-1.5 / py-0.5 /
 * text-3xs 都在 cva 里给，`font-medium` 是 Badge base 自带）；
 * **只留一条 `OUTLINE_RESET` 顶掉 `variant="outline"` 的 `border-border`**
 * （PR-1 时 CHIP_SHAPE 里也带这条、职责不变）。
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
