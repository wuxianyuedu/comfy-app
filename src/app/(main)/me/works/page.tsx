"use client";

import Link from "next/link";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { useMyWorks } from "./hooks/use-my-works";

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-subtle text-muted-foreground" },
  RUNNING: { label: "生成中", cls: "bg-primary-soft text-primary" },
  SUCCEEDED: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-500" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-700 dark:text-red-500" },
  CANCELLED: { label: "已取消", cls: "bg-subtle text-muted-foreground" },
};

export default function MyWorks() {
  const { tasks: data, isLoading } = useMyWorks();

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="u-title-page">我的作品</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            本机 ComfyUI 生成的所有结果，按时间倒序排列。
          </p>
        </div>
        <Link
          href="/workspace?tab=canvas"
          className="bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          去创作
        </Link>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">加载中…</p>
      ) : !data || data.length === 0 ? (
        <div className="border-border text-muted-foreground grid min-h-[300px] place-items-center rounded-2xl border border-dashed">
          <div className="text-center">
            <p className="text-ink text-lg font-medium">还没有作品</p>
            <p className="mt-1 text-sm">去创作台生成你的第一张图吧。</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((task) => {
            const st = STATUS[task.status] ?? STATUS.QUEUED!;
            const wf =
              getWorkflow(task.workflowName)?.label ?? task.workflowName;
            return (
              <div
                key={task.id}
                className="group border-border bg-surface hover:border-primary overflow-hidden rounded-2xl border transition-colors"
              >
                <div className="bg-bg relative aspect-square">
                  {task.cover ? (
                    <img
                      src={task.cover}
                      alt={task.prompt}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="text-muted-foreground grid h-full place-items-center text-xs">
                      {task.status === "FAILED" ? "生成失败" : "无预览"}
                    </div>
                  )}
                  <span
                    className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="bg-primary-soft text-primary rounded-md px-1.5 py-0.5 text-[11px] font-medium">
                      {wf}
                    </span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {task.prompt}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
