"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/updream/Toast";
import { MediaThumb, isVideo } from "@/components/updream/MediaThumb";
import { AuroraBackground } from "@/components/updream/AuroraBackground";
import { ValidationErrorList } from "@/components/updream/shared/ValidationErrorList";
import { api } from "~/trpc/react";
import { vanillaApi } from "~/trpc/vanilla";
import type { ValidationError } from "@/lib/comfyui/validation";

interface TaskItem {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  negativePrompt?: string | null;
  params?: Record<string, unknown> | null;
  error?: string | null;
  /** R-Next (2026-08-17): structured ComfyUI /prompt validation errors,
   *  present on FAILED tasks so the card can show a per-field list. */
  validationErrors?: ValidationError[] | null;
  createdAt: string;
  cover: string | null;
  coverIsCover?: boolean;
}

type FilterKey = "ALL" | "SUCCEEDED" | "RUNNING" | "FAILED" | "CANCELLED" | "QUEUED";
type SortKey = "newest" | "oldest";

interface StatusStyle {
  label: string;
  pillCls: string;
  // 左缘 3px accent（Tailwind border-l-4 系列）
  accentCls: string;
  // 整卡边框（失败/进行中/排队中加深）
  cardBorderCls: string;
  isActive: boolean;
  showProgress: boolean;
  // 失败错误转修复建议
  failureSuggestion?: (err?: string | null) => string;
}

const STATUS_STYLE: Record<string, StatusStyle> = {
  QUEUED: {
    label: "排队中",
    pillCls: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 border-dashed",
    accentCls: "border-l-cyan-500",
    cardBorderCls: "border-cyan-500/30 border-dashed",
    isActive: true,
    showProgress: false,
  },
  RUNNING: {
    label: "生成中",
    pillCls: "bg-violet-500/20 text-violet-300",
    accentCls: "border-l-violet-500",
    cardBorderCls: "border-violet-500/30",
    isActive: true,
    showProgress: true,
  },
  SUCCEEDED: {
    label: "已完成",
    pillCls: "bg-emerald-500/15 text-emerald-400",
    accentCls: "border-l-emerald-500",
    cardBorderCls: "border-white/[0.06]",
    isActive: false,
    showProgress: false,
  },
  FAILED: {
    label: "失败",
    pillCls: "bg-red-500/15 text-red-400",
    accentCls: "border-l-red-500",
    cardBorderCls: "border-red-500/30",
    isActive: false,
    showProgress: false,
    failureSuggestion: (err) => suggestFix(err),
  },
  CANCELLED: {
    label: "已取消",
    pillCls: "bg-white/10 text-gray-400",
    accentCls: "border-l-gray-500",
    cardBorderCls: "border-white/[0.06]",
    isActive: false,
    showProgress: false,
  },
};

interface FilterDef {
  key: FilterKey;
  label: string;
  /** 颜色：violet/emerald/red/gray/cyan，影响 pill 上的状态点；ALL 没有点。 */
  dotCls: string;
}

const FILTERS: FilterDef[] = [
  { key: "ALL", label: "全部", dotCls: "" },
  { key: "SUCCEEDED", label: "已完成", dotCls: "bg-emerald-400" },
  { key: "RUNNING", label: "进行中", dotCls: "bg-violet-400" },
  { key: "FAILED", label: "失败", dotCls: "bg-red-400" },
  { key: "CANCELLED", label: "已取消", dotCls: "bg-gray-400" },
];

function suggestFix(err?: string | null): string {
  if (!err) return "建议：检查 ComfyUI 服务状态后重试。";
  if (/ckpt|checkpoint/i.test(err))
    return "建议：检查 ckpt_name 是否存在于 ComfyUI 模型目录，或换一个可用模型。";
  if (/seed/i.test(err))
    return "建议：seed 值超出 INT 范围或被损坏，换一个随机 seed 重试。";
  if (/network|timeout|connect|ECONNREFUSED|fetch failed/i.test(err))
    return "建议：检查 ComfyUI(:8188) 是否在线、端口是否被防火墙阻挡。";
  if (/prompt|empty|null|undefined/i.test(err))
    return "建议：检查提示词是否为空或包含非法字符。";
  if (/out of memory|OOM|cuda/i.test(err))
    return "建议：降低 batch size / 分辨率，或切换到更小的模型。";
  if (/queue/i.test(err))
    return "建议：清空 ComfyUI 队列或重启服务后重试。";
  return `建议：复制错误码到 ComfyUI 控制台查日志：${err.slice(0, 40)}${err.length > 40 ? "…" : ""}`;
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  return `${day} 天前`;
}

/** 把 ISO 时间归到日期桶：今天 / 昨天 / yyyy-mm-dd */
function dateBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => {
    const r = new Date(x);
    r.setHours(0, 0, 0, 0);
    return r;
  };
  const today = startOfDay(now).getTime();
  const task = startOfDay(d).getTime();
  if (task === today) return "今天";
  if (task === today - 86400000) return "昨天";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 简单的「看起来在跑」动效：递增到 95% 后封顶；任务结束时归 0。 */
function useSimulatedProgress(tasks: TaskItem[]) {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const id = setInterval(() => {
      setMap((prev) => {
        const next = { ...prev };
        let dirty = false;
        for (const t of tasks) {
          if (t.status === "RUNNING") {
            const cur = prev[t.id] ?? 12 + Math.random() * 25;
            next[t.id] = Math.min(95, cur + Math.random() * 5);
            dirty = true;
          } else {
            if (prev[t.id] != null) {
              delete next[t.id];
              dirty = true;
            }
          }
        }
        return dirty ? next : prev;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [tasks]);
  return map;
}

const PAGE_SIZE = 8;

export function HistoryList({ onOpenTask: _onOpenTask }: { onOpenTask?: (id: string) => void }) {
  /* R-ardot60 (2026-08-15): 拿掉 modal「打开完整详情 ↗」按钮后 onOpenTask 变成无用 prop,
   *  重命名为 _onOpenTask 让 lint 沉默并保留向下兼容（父组件还在传，旧版可以仍然保留这个 prop）。
   *  用户反馈「在这里点开就显示详情，别在其他界面再显示」—— 历史 modal 是「这里」，
   *  「其他界面」是 `/create/${id}` 这条独立路由。 */
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [sort, setSort] = useState<SortKey>("newest");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  /** R-ardot63 (2026-08-15): 工作流默认值兜底（来自 /api/tasks/[id] 的 workflowHints）。
   *  当任务本身没记 seed/steps/cfg 时，用工作流 subgraph 里 KSampler 的硬编码值填卡。 */
  const [workflowHints, setWorkflowHints] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  /** 「打开目录」降级 popover：展示路径 + 协议打开引导。 */
  const [folderPopover, setFolderPopover] = useState<{ path: string } | null>(
    null
  );
  /** comfyapp:// 协议助手是否未注册（导航后页面未失焦，视为未接管）。 */
  const [helperMissing, setHelperMissing] = useState(false);
  /** 「打开目录」按钮防双击。 */
  const [openFolderBusy, setOpenFolderBusy] = useState(false);

  const progressMap = useSimulatedProgress(tasks);

  const tasksQ = api.task.list.useQuery();
  useEffect(() => {
    if (!tasksQ.isLoading) {
      setTasks((tasksQ.data?.tasks ?? []).map((t) => ({ ...t, createdAt: String(t.createdAt) } as TaskItem)));
      setLoading(false);
    }
  }, [tasksQ.isLoading, tasksQ.data?.tasks]);

  const load = useCallback(() => {
    setLoading(true);
    tasksQ.refetch().finally(() => setLoading(false));
  }, [tasksQ]);

  useEffect(() => {
    load();
  }, [load]);

  const detailQ = api.task.detail.useQuery(
    { id: detailId ?? "" },
    { enabled: !!detailId }
  );
  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    setWorkflowHints(null);
  }, []);

  useEffect(() => {
    if (!detailId) return;
    if (detailQ.isSuccess) {
      setDetail(detailQ.data);
      setWorkflowHints(null);
      setDetailLoading(false);
    } else if (detailQ.isError) {
      setDetail(null);
      setWorkflowHints(null);
      setDetailLoading(false);
    }
  }, [detailQ.isSuccess, detailQ.isError, detailQ.data, detailId]);

  // Allow external components (e.g. VideoQueueModal "详情") to open a task.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) openDetail(id);
    };
    window.addEventListener("open-task", handler);
    return () => window.removeEventListener("open-task", handler);
  }, [openDetail]);

  const cancelTask = api.task.cancel.useMutation();
  const deleteTask = api.task.delete.useMutation();

  const cancel = useCallback(
    async (id: string) => {
      try {
        await cancelTask.mutateAsync({ id });
        toast.info("已发送取消请求");
      } catch {
        toast.error("取消失败，请稍后重试");
      }
      load();
    },
    [cancelTask, load, toast]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("删除此任务记录？已生成的文件不会从磁盘删除。")) return;
      try {
        await deleteTask.mutateAsync({ id });
        toast.success("已删除任务");
        setTasks((prev) => prev.filter((t) => t.id !== id));
        if (detailId === id) setDetailId(null);
      } catch {
        toast.error("删除失败");
      }
    },
    [deleteTask, detailId, toast]
  );

  const retry = useCallback(
    async (t: TaskItem) => {
      setRetryingId(t.id);
      try {
        // 原 REST /api/tasks/[id]/retry 从未实现（历史一直 404）；后端无
        // 重试接口，复制参数到剪贴板，请到创作台手动重跑。
        const params = JSON.stringify(t.params ?? {}, null, 2);
        try {
          await navigator.clipboard?.writeText(
            `prompt: ${t.prompt ?? ""}\nworkflow: ${t.workflowName}\ntype: ${t.type}\nparams: ${params}`
          );
        } catch {
          /* noop */
        }
        toast.info("后端尚未提供重试接口，已复制参数到剪贴板，请到创作台手动重跑");
      } catch {
        toast.error("网络错误，重试请求未发送");
      } finally {
        setRetryingId(null);
        load();
      }
    },
    [load, toast]
  );

  // 筛选 + 排序
  const filtered = useMemo(() => {
    const f = filter === "ALL" ? tasks : tasks.filter((t) => t.status === filter);
    return [...f].sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return sort === "newest" ? db - da : da - db;
    });
  }, [tasks, filter, sort]);

  // 各状态计数
  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  // 按日期分组
  const grouped = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const t of filtered) {
      const k = dateBucket(t.createdAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return Array.from(m.entries()).map(([key, items]) => ({ key, items }));
  }, [filtered]);

  // 分页：先按 status 时间倒序，再按分组裁剪 displayCount
  const visibleGroups = useMemo(() => {
    let remaining = displayCount;
    const out: Array<{ key: string; items: TaskItem[] }> = [];
    for (const g of grouped) {
      if (remaining <= 0) break;
      const sliced = g.items.slice(0, remaining);
      if (sliced.length > 0) out.push({ key: g.key, items: sliced });
      remaining -= g.items.length;
    }
    return out;
  }, [grouped, displayCount]);

  const visibleTotal = visibleGroups.reduce((s, g) => s + g.items.length, 0);
  const canLoadMore = visibleTotal < filtered.length;

  const switchFilter = useCallback((k: FilterKey) => {
    setFilter(k);
    setDisplayCount(PAGE_SIZE);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">历史记录</h1>
            <p className="mt-1 text-sm text-gray-500">
              所有生成任务与执行日志，按时间倒序排列。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-violet-500/40"
              aria-label="排序"
            >
              <option value="newest" className="bg-[#16161e]">
                时间倒序
              </option>
              <option value="oldest" className="bg-[#16161e]">
                时间正序
              </option>
            </select>
            <button
              onClick={load}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              ↻ 刷新
            </button>
          </div>
        </div>

        {/* ── 状态筛选 pills ── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            const c = counts[f.key] ?? 0;
            return (
              <button
                key={f.key}
                onClick={() => switchFilter(f.key)}
                className={
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all " +
                  (isActive
                    ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20"
                    : "border border-white/[0.08] bg-white/[0.02] text-gray-300 hover:bg-white/[0.06]")
                }
              >
                {f.dotCls && (
                  <span className={`h-1.5 w-1.5 rounded-full ${f.dotCls}`} />
                )}
                <span>{f.label}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                    (isActive ? "bg-white/25 text-white" : "bg-white/[0.06] text-gray-400")
                  }
                >
                  {c}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">
                {filter === "ALL" ? "暂无任务记录" : `暂无${FILTERS.find((f) => f.key === filter)?.label ?? ""}任务`}
              </p>
              <p className="mt-1 text-sm">
                {filter === "ALL"
                  ? "在创作台生成内容后，历史记录会显示在这里。"
                  : "切换到「全部」可查看所有任务。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleGroups.map((g) => (
              <section key={g.key}>
                {/* ── 日期分组标题 ── */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-1 rounded-full bg-gradient-to-b from-violet-500 to-fuchsia-500" />
                  <h2 className="text-sm font-semibold text-gray-300">{g.key}</h2>
                  <span className="text-xs text-gray-600">{g.items.length} 个任务</span>
                  <div className="h-px flex-1 bg-white/[0.05]" />
                </div>

                {/* ── 任务列表 ── */}
                <div className="space-y-3">
                  {g.items.map((t) => {
                    const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.QUEUED;
                    const prog = progressMap[t.id] ?? 0;
                    const retrying = retryingId === t.id;
                    return (
                      <div
                        key={t.id}
                        className={
                          "group relative overflow-hidden rounded-2xl border bg-white/[0.02] pl-5 pr-3 py-3 transition-all hover:bg-white/[0.04] border-l-4 " +
                          st!.accentCls +
                          " " +
                          st!.cardBorderCls
                        }
                      >
                        {/* 左缘 accent 额外强调（border-l-4 已在父级，再叠一层高亮条） */}
                        <div
                          className={
                            "absolute left-0 top-0 bottom-0 w-1 " +
                            (t.status === "SUCCEEDED"
                              ? "bg-emerald-500"
                              : t.status === "RUNNING"
                              ? "bg-violet-500"
                              : t.status === "FAILED"
                              ? "bg-red-500"
                              : t.status === "QUEUED"
                              ? "bg-cyan-500"
                              : "bg-gray-500")
                          }
                          aria-hidden
                        />

                        <div className="flex items-center gap-4">
                          {/* ── 缩略图 ── */}
                          <button
                            onClick={() => openDetail(t.id)}
                            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#111118]"
                            aria-label="查看任务详情"
                          >
                            {t.cover ? (
                              <MediaThumb
                                src={t.cover}
                                alt=""
                                className="h-full w-full object-cover"
                                autoPlay
                                loop
                              />
                            ) : (
                              <span className="text-xs text-gray-600">
                                {t.status === "FAILED" ? "失败" : "无图"}
                              </span>
                            )}
                            {/* 进行中：底部进度条 */}
                            {st!.showProgress && (
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                                <div
                                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-1000 ease-linear"
                                  style={{ width: `${prog}%` }}
                                />
                              </div>
                            )}
                            {/* 排队中：虚线边框 + 计时图标 */}
                            {t.status === "QUEUED" && (
                              <div className="pointer-events-none absolute inset-0 rounded-xl border border-dashed border-cyan-500/40" />
                            )}
                          </button>

                          {/* ── 主体信息 ── */}
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => openDetail(t.id)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st!.pillCls}`}
                              >
                                {st!.label}
                              </span>
                              {st!.showProgress && (
                                <span className="text-[10px] tabular-nums text-violet-300">
                                  {Math.floor(prog)}%
                                </span>
                              )}
                              <span className="truncate text-xs text-gray-500">
                                {t.workflowName}
                              </span>
                              <span className="shrink-0 text-xs text-gray-600">
                                · {timeAgo(t.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-1 text-sm text-gray-300">
                              {t.prompt || "（无提示词）"}
                            </p>
                            {t.status === "FAILED" && t.error && (
                              <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1.5">
                                <p className="text-[11px] leading-relaxed text-red-300">
                                  <span className="font-semibold">错误：</span>
                                  {t.error}
                                </p>
                                {st!.failureSuggestion && (
                                  <p className="mt-1 text-[11px] leading-relaxed text-amber-300/90">
                                    {st!.failureSuggestion(t.error)}
                                  </p>
                                )}
                                {/* R-Next (2026-08-17): 结构化校验错误逐字段列表 */}
                                {t.validationErrors && t.validationErrors.length > 0 && (
                                  <div className="mt-1.5 rounded border border-red-400/20 bg-black/20 px-2 py-1.5">
                                    <div className="mb-1 text-[10px] font-semibold text-red-200">
                                      节点配置校验（{t.validationErrors.length} 项）
                                    </div>
                                    <ValidationErrorList
                                      errors={t.validationErrors}
                                      className="text-red-200/90"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* ── 操作按钮（永远可见） ── */}
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <div className="flex items-center gap-2">
                              {st!.isActive && (
                                <button
                                  onClick={() => cancel(t.id)}
                                  className="rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
                                >
                                  取消
                                </button>
                              )}
                              {t.status === "FAILED" && (
                                <button
                                  onClick={() => retry(t)}
                                  disabled={retrying}
                                  className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                                >
                                  {retrying ? "提交中…" : "↻ 重试"}
                                </button>
                              )}
                              <button
                                onClick={() => remove(t.id)}
                                className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* ── 分页 footer ── */}
            <div className="flex items-center justify-center gap-3 border-t border-white/[0.04] pt-6">
              <span className="text-xs text-gray-500">
                已加载 {visibleTotal} / {filtered.length} 个任务
              </span>
              {canLoadMore ? (
                <button
                  onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs text-gray-300 hover:bg-white/[0.08]"
                >
                  加载更多
                </button>
              ) : (
                <span className="text-[11px] text-gray-600">已全部加载</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailId && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 sm:p-6"
          onClick={() => setDetailId(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#16161e]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
              <h3 className="u-title">任务详情</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!detail?.id || openFolderBusy}
                  onClick={async () => {
                    if (!detail?.id) return;
                    setOpenFolderBusy(true);
                    try {
                      const d = await vanillaApi.task.openFolder.mutate({
                        id: detail.id,
                      });
                      if (d.comfyappUrl) {
                        // 本机自定义协议方案（R-ardot72）：服务端已校验目录存在且在
                        // 白名单内，返回 comfyapp://open?path=... URL。
                        // 这里直接导航（user-initiated 点击），浏览器弹「是否打开外部
                        // 应用」确认 → OS 调起 comfyapp:// handler 用 explorer 打开目录。
                        // 零下载、真正一键。
                        //
                        // 检测协议是否真的被 OS 接管：导航后若 2s 内页面失去焦点
                        // （外部 app 抢走焦点），视为已打开；否则认为未注册助手，
                        // 展示安装引导（防静默失败）。
                        let openedByOs = false;
                        const onBlur = () => {
                          openedByOs = true;
                          window.removeEventListener("blur", onBlur);
                          setHelperMissing(false);
                        };
                        window.addEventListener("blur", onBlur);
                        window.location.href = d.comfyappUrl;
                        window.setTimeout(() => {
                          window.removeEventListener("blur", onBlur);
                          if (!openedByOs) setHelperMissing(true);
                        }, 2000);
                        setFolderPopover({ path: d.absolutePath! });
                      } else if (d.error === "directory missing") {
                        toast.error("该任务尚未生成文件目录", d.absolutePath);
                      } else {
                        toast.error("打开目录失败");
                      }
                    } catch {
                      toast.error("无法连接服务器");
                    } finally {
                      setOpenFolderBusy(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title="在系统文件管理器中打开本次生成的目录（图片 / 视频 / 音频 / workflow.json / manifest.json 都在这里）"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  打开目录
                </button>
                {folderPopover && (
                  <div
                    className="absolute right-5 top-[52px] z-10 w-[min(440px,calc(100vw-40px))] rounded-lg border border-white/10 bg-[#0f0f17] p-3 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-gray-300">📂 在资源管理器中打开</span>
                      <button
                        type="button"
                        onClick={() => setFolderPopover(null)}
                        className="text-gray-500 hover:text-gray-200"
                        aria-label="关闭"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {helperMissing ? (
                      <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-200">
                        未检测到 ComfyApp 助手，浏览器没有弹出「打开外部应用」确认框。
                        请双击运行项目内 <code className="text-amber-100">scripts\install-comfyapp-helper.ps1</code> 注册
                        <code className="text-amber-100"> comfyapp://</code> 协议（仅本机、无需管理员），
                        或直接 <a href="/api/helper/install" className="underline hover:text-amber-100">下载安装脚本</a>。
                      </div>
                    ) : (
                      <div className="mb-2 rounded border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-emerald-200/90">
                        若浏览器弹出「是否打开外部应用」，点击「打开」即可在资源管理器中打开该目录。
                      </div>
                    )}
                    <code className="block select-all break-all rounded bg-black/40 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-300">
                      {folderPopover.path}
                    </code>
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(folderPopover.path);
                            toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转");
                            return;
                          } catch {
                            /* 继续走 fallback */
                          }
                          // 兜底：clipboard API 被禁时，用临时 textarea
                          const ta = document.createElement("textarea");
                          ta.value = folderPopover.path;
                          ta.style.position = "fixed";
                          ta.style.opacity = "0";
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand("copy");
                          document.body.removeChild(ta);
                          toast.success("路径已复制", "粘贴到资源管理器地址栏（Alt+D）即可跳转");
                        }}
                        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:border-emerald-500/60 hover:text-emerald-100"
                      >
                        📋 复制路径
                      </button>
                    </div>
                  </div>
                )}
                {(() => {
                  const first = Array.isArray(detail?.images) ? detail.images[0] : null;
                  if (!first?.localPath) return null;
                  const snapSource = (detail?.workflowSnapshot as
                    | { source?: string }
                    | null
                    | undefined)?.source;
                  const sourceLabel =
                    snapSource === "backfill"
                      ? "历史记录回填快照"
                      : snapSource === "execution"
                      ? "执行时自动捕获的独立快照"
                      : "磁盘回退快照";
                  return (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const d = await vanillaApi.task.workflow.query({ id: detail.id });
                            if (!d.workflow) {
                              toast.error("未找到工作流快照");
                              return;
                            }
                            const blob = new Blob([JSON.stringify(d.workflow, null, 2)], {
                              type: "application/json",
                            });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = "workflow.json";
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch {
                            toast.error("下载失败");
                          }
                        }}
                        className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-white/20 hover:text-white"
                        title="下载本次执行实际用到的工作流 JSON（含当时的节点与参数，工作流模板后续改动也不影响复现）"
                      >
                        下载工作流
                      </button>
                      <span
                        className="hidden rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-500 sm:inline"
                        title={sourceLabel}
                      >
                        {sourceLabel}
                      </span>
                    </div>
                  );
                })()}
                <button
                  onClick={() => setDetailId(null)}
                  className="text-gray-500 hover:text-gray-200"
                  aria-label="关闭"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {detailLoading ? (
                <p className="text-sm text-gray-500">加载中…</p>
              ) : detail ? (
                <div className="space-y-4">
                  {detail.images?.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {detail.images.map((img: any, i: number) => (
                        <div
                          key={i}
                          className="group relative overflow-hidden rounded-xl border border-white/[0.06]"
                        >
                          <MediaThumb
                            src={img.localPath}
                            alt=""
                            className="aspect-square w-full object-cover"
                            autoPlay
                            loop
                          />
                          <a
                            href={img.localPath}
                            download
                            className="absolute bottom-2 right-2 rounded bg-white/15 px-2 py-0.5 text-[11px] text-white opacity-0 transition-opacity hover:bg-white/25 group-hover:opacity-100"
                          >
                            {isVideo(img.localPath) ? "下载视频" : "下载"}
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">该任务没有生成图像。</p>
                  )}

                  {/* R-ardot60 (2026-08-15): prompt 回退——workflow 任务的 prompt 存在
                   *  detail.params.workflowInputs[0].value 而不是 detail.prompt。
                   *  之前 detail.prompt 为空时直接显示「—」,用户以为「数据没显示全」。 */}
                  {(() => {
                    const params = (detail.params ?? {}) as Record<string, any>;
                    const wfInputs: Array<{ name: string; value: unknown }> = Array.isArray(
                      params.workflowInputs
                    )
                      ? params.workflowInputs
                      : [];
                    const fallbackPrompt = (() => {
                      const hit = wfInputs.find(
                        (w: any) =>
                          w?.name === "text" ||
                          w?.name === "prompt" ||
                          w?.name === "positive"
                      );
                      return hit && typeof hit.value === "string" ? hit.value : "";
                    })();
                    const showPrompt = detail.prompt || fallbackPrompt;
                    return (
                      <>
                        {showPrompt && (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-gray-400">
                              正向提示词
                            </p>
                            <p className="whitespace-pre-wrap break-words text-sm text-gray-300">
                              {showPrompt}
                            </p>
                          </div>
                        )}
                        {detail.negativePrompt && (
                          <div>
                            <p className="mb-1 text-xs font-semibold text-gray-400">
                              反向提示词
                            </p>
                            <p className="whitespace-pre-wrap break-words text-sm text-gray-400">
                              {detail.negativePrompt}
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* R-ardot61 (2026-08-15): 生成参数卡 —— seed/step/cfg/sampler/scheduler
                   *  等生成参数分散在 params.workflowInputs[]（按 name）或顶层 params，
                   *  以前只在 collapsed raw JSON 里才看得到，用户要「一眼能看到」。
                   *  这里抽出常见生成参数做成网格卡，并去重（同 label 只取优先 key）。
                   *  R-ardot63 (2026-08-15): 进一步加工作流默认值兜底 —— 有些工作流（如 z-image）
                   *  把 steps/cfg/sampler/scheduler/denoise/size 硬编码在 subgraph 内 KSampler/
                   *  Empty*Latent 节点的 widgets_values，从不暴露给用户，也写不进 params；
                   *  这里再从 workflowHints（/api/tasks/[id] 的子字段）回填这些非随机字段。
                   *  R-ardot62 (2026-08-15): seed 走真值 —— 后端从 ComfyUI history 的 prompt[2] graph
                   *  里 KSampler.inputs.seed 抽出，落在 `params.runtime.seed` + `TaskImage.seed`，
                   *  通过 workflowHints.seedSource="history" 标记。前端优先用此值，回退到用户填值。 */}
                  {(() => {
                    const params = (detail.params ?? {}) as Record<string, any>;
                    const wfInputs: Array<{ nodeId?: string; name: string; value: unknown }> =
                      Array.isArray(params.workflowInputs) ? params.workflowInputs : [];
                    const GEN_ORDER: Array<{ keys: string[]; label: string; hint?: string }> = [
                      { keys: ["seed", "noise_seed", "image_seed"], label: "种子" },
                      { keys: ["steps"], label: "步数" },
                      { keys: ["cfg"], label: "CFG" },
                      { keys: ["sampler_name", "sampler"], label: "采样器" },
                      { keys: ["scheduler"], label: "调度器" },
                      { keys: ["denoise"], label: "去噪" },
                      { keys: ["size", "width"], label: "尺寸" },
                    ];
                    /** R-ardot63 (2026-08-15): 工作流默认值兜底 —— 同 label 多个源按优先级合并：
                     *  params > workflowInputs > workflowHints.{steps,cfg,...} > TaskImage.{width,height,seed}。
                     *  R-ardot62：seed 优先用 workflowHints.seed（来自 ComfyUI history 真值）。 */
                    const wf = (workflowHints ?? {}) as {
                      steps?: number; cfg?: number;
                      sampler_name?: string; scheduler?: string; denoise?: number;
                      width?: number; height?: number;
                      seed?: number; seedSource?: "history" | "subgraph" | "top" | "request" | null;
                    };
                    const coverImage = Array.isArray(detail.images) && detail.images.length > 0
                      ? detail.images.find((im: any) => im.isCover) ?? detail.images[0] : null;
                    const coverSize = coverImage
                      ? (coverImage.width && coverImage.height ? `${coverImage.width}×${coverImage.height}` : undefined)
                      : undefined;
                    const findVal = (keys: string[]) => {
                      // R-ardot62：seed 优先用 history 真值（最权威），其次用户填值，最后 workflow 元数据。
                      // 但 params[k] 路径在 R-ardot63 之前一直有效，所以保留 ① 顶层 ② workflowInputs ③ workflowHints/coverImage 顺序。
                      for (const k of keys) {
                        if (params[k] !== undefined && params[k] !== null && params[k] !== "")
                          return params[k];
                      }
                      for (const k of keys) {
                        const hit = wfInputs.find(
                          (w) => String(w.name).toLowerCase() === k.toLowerCase()
                        );
                        if (hit && hit.value !== undefined && hit.value !== null && hit.value !== "")
                          return hit.value;
                      }
                      // R-ardot63 工作流默认值兜底（非随机字段）
                      for (const k of keys) {
                        if (k === "size") {
                          if (wf.width && wf.height) return `${wf.width}×${wf.height}`;
                          if (coverSize) return coverSize;
                        } else if (
                          k === "seed" && coverImage?.seed != null && String(coverImage.seed).trim() !== ""
                        ) {
                          return coverImage.seed;
                        } else if (k in wf) {
                          const v = (wf as Record<string, unknown>)[k];
                          if (v !== undefined && v !== null && v !== "") return v;
                        }
                      }
                      return undefined;
                    };
                    const seenLabels = new Set<string>();
                    const genValues: Array<{ label: string; value: unknown; hint?: string }> = [];
                    for (const { keys, label, hint } of GEN_ORDER) {
                      if (seenLabels.has(label)) continue;
                      const v = findVal(keys);
                      if (v !== undefined) {
                        genValues.push({ label, value: v, hint });
                        seenLabels.add(label);
                      }
                    }
                    // R-ardot62：根据 seed 来源加精准 hint，区分「真值 / 用户填值 / 默认值」。
                    if (wf.seed !== undefined) {
                      const seedEntry = genValues.find((g) => g.label === "种子");
                      if (seedEntry) {
                        seedEntry.hint =
                          wf.seedSource === "history"
                            ? "本次执行真实使用值"
                            : wf.seedSource === "request"
                              ? "用户提交时填写的 seed"
                              : undefined;
                      }
                    }
                    if (genValues.length === 0) {
                      // R-ardot63 空态说明：让用户一眼知道是工作流没暴露参数，不是系统 bug。
                      return (
                        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-xs text-gray-500">
                          本任务所用工作流未暴露常见生成参数（seed/steps/cfg 等在节点硬编码默认值中）。
                          如需查看完整参数，请展开下方的「原始 JSON」。
                        </div>
                      );
                    }
                    return (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-gray-400">生成参数</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 sm:grid-cols-3">
                          {genValues.map((g) => (
                            <div key={g.label} className="flex flex-col gap-0.5">
                              <div className="flex items-baseline gap-2">
                                <span className="shrink-0 text-[11px] text-gray-500">{g.label}</span>
                                <span className="min-w-0 break-words font-mono text-[12px] text-gray-200">
                                  {typeof g.value === "string" || typeof g.value === "number"
                                    ? String(g.value)
                                    : JSON.stringify(g.value)}
                                </span>
                              </div>
                              {g.hint && (
                                <span className="pl-0.5 text-[10px] leading-tight text-gray-500/80">{g.hint}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {genValues.some((g) => g.hint) && (
                          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                            注：种子字段在 control_after_generate=randomize 时为默认值，非本次执行的真实种子。
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {detail.error && (
                    <div className="rounded-lg bg-red-500/10 p-2.5 text-xs text-red-300">
                      错误：{detail.error}
                    </div>
                  )}

                  {/* R-ardot60: 参数展示——把 workflowInputs 抽成可读「参数表」,
                   *  再附 raw JSON 块(可换行 wrap,不再撑破 modal)。 */}
                  {(() => {
                    const params = (detail.params ?? {}) as Record<string, any>;
                    const GEN_KEYS_LOWER = new Set([
                      "seed",
                      "steps",
                      "cfg",
                      "sampler_name",
                      "sampler",
                      "scheduler",
                      "denoise",
                      "size",
                    ]);
                    const wfInputs: Array<{ nodeId?: string; name: string; value: unknown }> =
                      Array.isArray(params.workflowInputs)
                        ? params.workflowInputs.filter(
                            (w: any) => !GEN_KEYS_LOWER.has(String(w.name).toLowerCase())
                          )
                        : [];
                    const topLevelEntries = Object.entries(params).filter(
                      ([k]) => k !== "workflowInputs"
                    );
                    const hasAny =
                      wfInputs.length > 0 || topLevelEntries.length > 0;
                    if (!hasAny) return null;
                    return (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-gray-400">参数</p>

                        {wfInputs.length > 0 && (
                          <div className="mb-2 overflow-hidden rounded-lg border border-white/[0.06]">
                            <table className="w-full text-[11px]">
                              <tbody>
                                {wfInputs.map((w, i) => (
                                  <tr
                                    key={(w.nodeId ?? "?") + ":" + w.name + ":" + i}
                                    className="border-b border-white/[0.04] last:border-b-0"
                                  >
                                    <td className="w-[36%] max-w-[180px] shrink-0 truncate align-top border-r border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5 font-mono text-violet-300"
                                      title={w.name}
                                    >
                                      {w.name}
                                    </td>
                                    <td className="break-words px-2.5 py-1.5 text-gray-200">
                                      {typeof w.value === "string"
                                        ? w.value
                                        : JSON.stringify(w.value)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {topLevelEntries.length > 0 && (
                          <details className="rounded-lg border border-white/[0.06] bg-black/30">
                            <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-gray-500 hover:text-gray-300">
                              原始 JSON · {topLevelEntries.length + (wfInputs.length ? 1 : 0)} 个字段
                            </summary>
                            <pre className="max-w-full whitespace-pre-wrap break-all border-t border-white/[0.06] p-3 text-[11px] text-gray-400">
                              {JSON.stringify(params, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-sm text-gray-500">未找到任务。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}