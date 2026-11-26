import type { StatusDotState } from "~/components/ui/status-dot";
import type { ValidationError } from "~/lib/comfyui/validation";
import type { RouterOutputs } from "~/trpc/react";

export type TaskItem = {
  /** 最近活动时刻：终态任务取完成时刻，老行回落领取 / 提交时刻（#5076）。 */
  claimedAt?: string | null;
  cover: string | null;
  coverIsCover?: boolean;
  createdAt: string;
  error?: string | null;
  finishedAt?: string | null;
  id: string;
  /** 模型名称（ISSUE #4619）：任务所用工作流上挂的模型标签，服务端随
   *  task.list 批量解析；工作流没挂标签 / 模板引用缺失时为 null（前端回落
   *  工作流名，行上仍能认出这是哪次提交）。 */
  modelName?: string | null;
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

/**
 * 历史页的取数口径：**只取终态任务**（已完成 / 失败 / 已取消）。
 * 排队中 / 进行中的任务不是「生成好的内容」，不进历史——它们在「队列」页
 * （QueueMonitor）看。ISSUE #5009 现场反馈：批量生图的一千条排队任务把
 * 历史页糊满「无图待生成」卡片，历史页因此只应呈现终态。
 */
export const HISTORY_TASK_STATUSES = "SUCCEEDED,FAILED,CANCELLED";

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
  { key: "FAILED", label: "失败", tone: "down" },
  { key: "CANCELLED", label: "已取消", tone: "busy" },
];
