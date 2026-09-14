"use client";

import {
  getWorkflowType,
  normalizeTaskType,
  type WorkflowCategory,
} from "@/lib/workflow-types";

/**
 * 工作流类型只读标签，按 image / video / audio 分类着色。
 */
export function TaskTypeChip({ taskType }: { taskType?: string | null }) {
  const code = normalizeTaskType(taskType ?? "");
  const def = getWorkflowType(code);
  const label = (def?.label ?? code) || "未选";
  const category = def?.category ?? "image";
  const styles = CATEGORY_STYLES[category];

  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${styles.bg} ${styles.text}`}
      title={def?.description ?? label}
    >
      {label}
    </span>
  );
}

const CATEGORY_STYLES: Record<WorkflowCategory, { bg: string; text: string }> =
  {
    image: { bg: "bg-violet-500/12", text: "text-violet-700 dark:text-violet-300" },
    video: { bg: "bg-sky-500/12", text: "text-sky-700 dark:text-sky-300" },
    audio: { bg: "bg-amber-500/12", text: "text-amber-700 dark:text-amber-300" },
  };
