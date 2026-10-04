"use client";

import { Badge } from "~/components/ui/badge";

/**
 * 工作流来源标签：本地 / 在线（`<Badge size="sm" variant="outline">`
 * 薄封装，规范 §16.2.3 / §12.18 的 P67 治理）。
 *
 * 与 `task-type-chip` 的差异：这里不是「哪一种媒体的分类锚点」、而是
 * 「这一条工作流的**来源状态**」（本地已连磁盘 / 在线只在 DB）——语义
 * 更接近状态色，**必须走语义 token**（§4.11.1）。此前把 emerald 字面量
 * 写在这里（`bg-emerald-500/12 text-emerald-700 dark:text-emerald-400`），
 * 「把成功色换成 teal」改不动它；PR-1 治理时两档分别取 `success` /
 * `subtle`，与 `status-badge` / `list-badge` 同一份 token 面板。
 *
 * **PR-4 之后本次 cleanup**：Badge cva 加了 `size` 轴（default / sm /
 * xs），本件从手抄 `CHIP_SHAPE` 常量迁到 `size="sm"`（h-auto /
 * rounded-md / px-1.5 / py-0.5 / text-3xs 都在 cva 里给）；**只留
 * 一条 `OUTLINE_RESET` 顶掉 `variant="outline"` 的 `border-border`**
 * ——与 `task-type-chip` 同档（同一列表里两个 chip 并排，圆角 / 高度 /
 * 边框处理必须一致）。
 *
 * 未走 `tone` 轴（Badge cva PR-4 也加了 5 档语义色）的取舍：本件 local
 * 档刻意用 `bg-success/12`（比 tone.success 的 `/10` 稍强一档），因为
 * 密集列表里「本地工作流」需要比"完成态"更显眼一档的锚点提示、观感选择;
 * online 档用 `bg-subtle text-ink-faint`（PR-1 治理后已 token 化、
 * 与 tone.neutral 只差文字色一档 faint vs muted、保持视觉不漂）。若后
 * 续想让全库徽章完全走同一 tone 表,可再开一个 PR 把两档改成
 * `tone="success"` / `tone="neutral"`,一并把 status-badge 家族的
 * 半透明度做统一。本 PR 只做 CHIP_SHAPE → size=sm 的搬迁,不引入
 * 视觉漂移。
 */
const OUTLINE_RESET = "border-transparent";

export function SourceTag({
  source,
  local,
}: {
  source?: string | null;
  local?: boolean | null;
}) {
  const isLocal = local ?? source === "local";
  if (isLocal) {
    return (
      <Badge
        size="sm"
        variant="outline"
        className={`${OUTLINE_RESET} bg-success/12 text-success-strong`}
        title="本地工作流 · 已连接磁盘文件"
      >
        本地
      </Badge>
    );
  }
  return (
    <Badge
      size="sm"
      variant="outline"
      className={`${OUTLINE_RESET} bg-subtle text-ink-faint`}
      title="在线工作流 · 粘贴/API 导入，保存在数据库"
    >
      在线
    </Badge>
  );
}
