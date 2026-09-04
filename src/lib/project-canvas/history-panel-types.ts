/* ── 画布历史面板：类型与纯派生（第①层配置）─────────────────────────────
 * 从 HistoryPanel.tsx 里搬出来的「不涉及请求、不涉及 React」的部分：
 * 任务行类型、状态/类型配色、时间相对格式化、卡片标题回落、类型图标。
 *
 * 放在 lib 而不是 components 下：history-panel-client.ts（网络层）需要引用
 * HistoryTaskRow，而 lib 不得 import components（H1 依赖倒置）。
 *
 * 与 studio/history/ 域的同名函数**刻意不合并**：那边是「全量历史页」
 * （分页 + 日期分组 + 排序），这边是画布侧栏（80 条 + 网格/列表双密度），
 * 语义不同，硬抽只会制造第二个错误抽象（§17.6.1 同款判断）。
 */

export type HistoryFilter = "all" | "image" | "video" | "audio";
export type HistoryScope = "project" | "all";
export type DisplayMode = "grid" | "list";
export type TaskMediaType = "image" | "video" | "audio";

/** 镜像 /api/tasks（task.list）响应行的前端形状。 */
export interface HistoryTaskRow {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  createdAt: string;
  cover: string | null;
  mediaType: TaskMediaType;
  projectId: string | null;
  progress: number;
  error: string | null;
}

export const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-cyan-500/15 text-cyan-300" },
  RUNNING: { label: "生成中", cls: "bg-violet-500/20 text-violet-300" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "已取消", cls: "bg-white/10 text-gray-400" },
};

export const KIND_STYLE: Record<TaskMediaType, string> = {
  image: "bg-violet-500/10 text-violet-400",
  video: "bg-blue-500/10 text-blue-400",
  audio: "bg-emerald-500/10 text-emerald-400",
};

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** 卡片主标题：优先提示词摘要，退回工作流名，最后退回任务 id 短码。 */
export function titleOf(task: HistoryTaskRow): string {
  const p = task.prompt?.trim();
  if (p) return p.length > 40 ? `${p.slice(0, 40)}…` : p;
  if (task.workflowName) return task.workflowName;
  return task.id.slice(0, 12);
}

/** 进行中（需要轮询）的任务数。 */
export function countActive(tasks: HistoryTaskRow[]): number {
  return tasks.filter((task) => task.status === "RUNNING" || task.status === "QUEUED").length;
}

/** 只有图片/视频封面可拖拽到画布；音频没有可视封面。 */
export function isDraggableCover(task: HistoryTaskRow): boolean {
  return !!task.cover && (task.mediaType === "image" || task.mediaType === "video");
}

export const FILTER_TABS: { id: HistoryFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
];
