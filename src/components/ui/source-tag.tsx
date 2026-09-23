"use client";

import { Badge } from "~/components/ui/badge";

/**
 * 工作流来源标签：本地 / 在线（`<Badge>` 薄封装，规范 §16.2.3 / §12.18 的
 * P67 治理）。
 *
 * 与 `task-type-chip` 的差异：这里不是「哪一种媒体的分类锚点」、而是
 * 「这一条工作流的**来源状态**」（本地已连磁盘 / 在线只在 DB）——语义
 * 更接近状态色，**必须走语义 token**（§4.11.1）。此前把 emerald 字面量
 * 写在这里（`bg-emerald-500/12 text-emerald-700 dark:text-emerald-400`），
 * 「把成功色换成 teal」改不动它；现在两档分别取 `success` / `subtle`，
 * 与 `status-badge` / `list-badge` 同一份 token 面板。
 *
 * `variant="outline"` 借 Badge 的 `border-border` 兜底 + 我们自己盖
 * `border-transparent`（同 `task-type-chip`）：两档 tag 都**不想要边框**，
 * 只要色底 + 色字。尺寸走 `CHIP_SHAPE` 与 task-type-chip 一致（同一列表
 * 里两个 chip 并排，圆角 / 高度必须同档）。
 */
const CHIP_SHAPE =
  "h-auto rounded-md border-transparent px-1.5 py-0.5 text-[10px] font-medium";

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
        variant="outline"
        className={`${CHIP_SHAPE} bg-success/12 text-success-strong`}
        title="本地工作流 · 已连接磁盘文件"
      >
        本地
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`${CHIP_SHAPE} bg-subtle text-ink-faint`}
      title="在线工作流 · 粘贴/API 导入，保存在数据库"
    >
      在线
    </Badge>
  );
}
