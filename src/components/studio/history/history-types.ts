import type { ValidationError } from "@/lib/comfyui/validation";
import { type RouterOutputs } from "~/trpc/react";

export interface TaskItem {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  negativePrompt?: string | null;
  params?: Record<string, unknown> | null;
  error?: string | null;
  /** structured ComfyUI /prompt validation errors,
   *  present on FAILED tasks so the card can show a per-field list. */
  validationErrors?: ValidationError[] | null;
  createdAt: string;
  cover: string | null;
  coverIsCover?: boolean;
}

export type FilterKey =
  | "ALL"
  | "SUCCEEDED"
  | "RUNNING"
  | "FAILED"
  | "CANCELLED"
  | "QUEUED";

export type SortKey = "newest" | "oldest";

/** 任务详情（来自 tRPC task.detail 的完整输出）。 */
export type TaskDetail = NonNullable<RouterOutputs["task"]["detail"]>;

export interface FilterDef {
  key: FilterKey;
  label: string;
  /** 颜色：violet/emerald/red/gray/cyan，影响 pill 上的状态点；ALL 没有点。 */
  dotCls: string;
}

export const FILTERS: FilterDef[] = [
  { key: "ALL", label: "全部", dotCls: "" },
  { key: "SUCCEEDED", label: "已完成", dotCls: "bg-emerald-400" },
  { key: "RUNNING", label: "进行中", dotCls: "bg-violet-400" },
  { key: "FAILED", label: "失败", dotCls: "bg-red-400" },
  { key: "CANCELLED", label: "已取消", dotCls: "bg-gray-400" },
];
