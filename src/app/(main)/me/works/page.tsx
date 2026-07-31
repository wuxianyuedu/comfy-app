"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWorkflow } from "@/lib/comfyui/_meta";

type TaskItem = {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  prompt: string;
  createdAt: string;
  cover: string | null;
  checkpoint: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "排队中", cls: "bg-subtle text-muted" },
  RUNNING: { label: "生成中", cls: "bg-primary-soft text-primary" },
  SUCCEEDED: { label: "已完成", cls: "bg-emerald-500/15 text-emerald-500" },
  FAILED: { label: "失败", cls: "bg-red-500/15 text-red-500" },
  CANCELLED: { label: "已取消", cls: "bg-subtle text-muted" },
};

export default function MyWorks() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的作品</h1>
          <p className="mt-1 text-sm text-muted">本机 ComfyUI 生成的所有结果，按时间倒序排列。</p>
        </div>
        <Link
          href="/create"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          去创作
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : tasks.length === 0 ? (
        <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-border text-muted">
          <div className="text-center">
            <p className="text-lg font-medium text-ink">还没有作品</p>
            <p className="mt-1 text-sm">去创作台生成你的第一张图吧。</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tasks.map((t) => {
            const st = STATUS[t.status] ?? STATUS.QUEUED;
            const wf = getWorkflow(t.workflowName)?.label ?? t.workflowName;
            return (
              <Link
                key={t.id}
                href={`/create/${t.id}`}
                className="group overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-primary"
              >
                <div className="relative aspect-square bg-bg">
                  {t.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.cover}
                      alt={t.prompt}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted">
                      {t.status === "FAILED" ? "生成失败" : "无预览"}
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
                  <p className="line-clamp-2 text-xs text-muted">{t.prompt}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
