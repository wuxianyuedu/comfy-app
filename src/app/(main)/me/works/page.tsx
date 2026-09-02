"use client";

import Link from "next/link";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { api } from "~/trpc/react";

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-subtle text-muted-foreground" },
  RUNNING: { label: "生成中", cls: "bg-primary-soft text-primary" },
  SUCCEEDED: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-500" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-500" },
  CANCELLED: { label: "已取消", cls: "bg-subtle text-muted-foreground" },
};

export default function MyWorks() {
  const { data, isLoading } = api.task.list.useQuery();

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="u-title-page">我的作品</h1>
          <p className="mt-1 text-sm text-muted-foreground">本机 ComfyUI 生成的所有结果，按时间倒序排列。</p>
        </div>
        <Link
          href="/workspace?tab=canvas"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          去创作
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : !data?.tasks || data.tasks.length === 0 ? (
        <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-border text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium text-ink">还没有作品</p>
            <p className="mt-1 text-sm">去创作台生成你的第一张图吧。</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.tasks.map((task) =>
{
            const st = STATUS[task.status] ?? STATUS.QUEUED!;
            const wf = getWorkflow(task.workflowName)?.label ?? task.workflowName;
            return (
              <div
                key={task.id}
                className="group overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-primary"
              >
                <div className="relative aspect-square bg-bg">
                  {task.cover ? (
                     
                    <img
                      src={task.cover}
                      alt={task.prompt}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted-foreground">
                      {task.status === "FAILED" ? "生成失败" : "无预览"}
                    </div>
                  )}
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}
                  >
                    {st.label}
                  </span>
                </div>
                <div className="p-3">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {wf}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{task.prompt}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
