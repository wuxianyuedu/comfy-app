import type { StatusDotState } from "~/components/ui/status-dot";
import type { ValidationError } from "~/lib/comfyui/validation";
import { type RouterOutputs } from "~/trpc/react";

export interface TaskItem {
  cover: string | null;
  coverIsCover?: boolean;
  createdAt: string;
  error?: string | null;
  id: string;
  negativePrompt?: string | null;
  params?: Record<string, unknown> | null;
  prompt: string;
  status: string;
  type: string;
  /** 结构化的 ComfyUI /prompt 校验错误，
   *  在 FAILED 任务上存在，好让卡片显示逐字段清单。 */
  validationErrors?: Array<ValidationError> | null;
  workflowName: string;
}

export type FilterKey = "ALL" | "SUCCEEDED" | "RUNNING" | "FAILED" | "CANCELLED" | "QUEUED";

export type SortKey = "newest" | "oldest";

/** 任务详情（来自 tRPC task.detail 的完整输出）。 */
export type TaskDetail = NonNullable<RouterOutputs["task"]["detail"]>;

export interface FilterDef {
  key: FilterKey;
  label: string;
  /** 这一枚筛选对应的**状态语义**（`ALL` 不给圆点）。
   *
   * 此前这里存的是 Tailwind 类名的**字面量**（`"bg-success-strong"` /
   * `"bg-primary"` / `"bg-destructive"` / `"bg-gray-400"`）—— 一个 `.ts`
   * 配置模块直接持有样式字符串，于是「换个状态色」要在这里改、且 `bg-gray-400`
   * 那一条绕过了全库的语义 token（规范 03 §3.6.2）。现在只给语义键，
   * 由 `ui/status-dot` 的 `StatusDotState` 唯一一处翻译成颜色。 */
  tone?: StatusDotState;
}

export const FILTERS: Array<FilterDef> = [
  { key: "ALL", label: "全部" },
  { key: "SUCCEEDED", label: "已完成", tone: "up" },
  { key: "RUNNING", label: "进行中", tone: "probing" },
  { key: "FAILED", label: "失败", tone: "down" },
  { key: "CANCELLED", label: "已取消", tone: "busy" },
];
