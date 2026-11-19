"use client";

import { Badge } from "~/components/ui/badge";

/**
 * 工作流来源标签：本地 / 在线（`<Badge size="sm" variant="outline">` 薄封装，规范 §16.2.3 / §12.18）。与 `task-type-chip` 的差异：这里不是媒体分类锚点，而是「这一条工作流的来源状态」，必须走语义 token（§4.11.1）——此前 emerald 字面量写死、「把成功色换成 teal」改不动它。
 * Badge cva 加了 `size` 轴后本件迁到 `size="sm"`，只留 `OUTLINE_RESET` 顶掉 `variant="outline"` 的 `border-border`（与 `task-type-chip` 同档）。未走 `tone` 轴是刻意取舍：local 用 `bg-success/12` 比 `tone.success` 的 `/10` 更强一档，online 用 `bg-subtle text-ink-faint`，保持视觉不漂。
 */
const OUTLINE_RESET = "border-transparent";

export function SourceTag({ source, local }: { local?: boolean | null; source?: string | null }) {
  const isLocal = local ?? source === "local";
  if (isLocal) {
    return (
      <Badge
        className={`${OUTLINE_RESET} bg-success/12 text-success-strong`}
        size="sm"
        title="本地工作流 · 已连接磁盘文件"
        variant="outline"
      >
        本地
      </Badge>
    );
  }
  return (
    <Badge
      className={`${OUTLINE_RESET} bg-subtle text-ink-faint`}
      size="sm"
      title="在线工作流 · 粘贴/API 导入，保存在数据库"
      variant="outline"
    >
      在线
    </Badge>
  );
}
