import type { StatusDotState } from "~/components/ui/status-dot";
import type { ValidationError } from "~/lib/comfyui/validation";
import type { RouterOutputs } from "~/trpc/react";

export type TaskItem = {
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
};

export type FilterKey = "ALL" | "SUCCEEDED" | "RUNNING" | "FAILED" | "CANCELLED" | "QUEUED";

export type SortKey = "newest" | "oldest";

/** 任务详情（来自 tRPC task.detail 的完整输出）。 */
export type TaskDetail = NonNullable<RouterOutputs["task"]["detail"]>;

export type FilterDef = {
  key: FilterKey;
  label: string;
  /** 这一枚筛选的状态语义（ALL 不给圆点）。此前存 Tailwind 类名字面量
   *（"bg-success-strong" 等），配置模块直接持样式字符串、且 bg-gray-400 绕过语义 token；
   * 现在只给语义键，由 ui/status-dot 的 StatusDotState 唯一翻译成颜色。 */
  tone?: StatusDotState;
};

export const FILTERS: Array<FilterDef> = [
  { key: "ALL", label: "全部" },
  { key: "SUCCEEDED", label: "已完成", tone: "up" },
  { key: "RUNNING", label: "进行中", tone: "probing" },
  { key: "FAILED", label: "失败", tone: "down" },
  { key: "CANCELLED", label: "已取消", tone: "busy" },
];
