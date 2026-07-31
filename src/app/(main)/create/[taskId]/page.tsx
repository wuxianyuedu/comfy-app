import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { getWorkflow } from "@/lib/comfyui/_meta";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

export default async function TaskDetail({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { images: { orderBy: { sortIndex: "asc" } } },
  });
  if (!task) notFound();

  const p = (task.params as Record<string, any>) ?? {};

  const workflowLabel = getWorkflow(task.workflowName)?.label ?? task.workflowName;
  const meta: [string, string][] = [
    ["工作流", `${workflowLabel}（${task.workflowName}）`],
    ["正向提示词", task.prompt],
    ["反向提示词", task.negativePrompt ?? "—"],
    ["大模型", p.checkpoint ?? "—"],
    ["采样器", `${p.sampler ?? "—"} / ${p.scheduler ?? "—"}`],
    ["步数 / CFG", `${p.steps ?? "—"} / ${p.cfg ?? "—"}`],
    ["尺寸 / 数量", `${p.size ?? "—"} / ${p.count ?? "—"}`],
    ["种子", String(p.seed ?? "随机")],
    ["LoRA", (p.loras ?? []).map((l: any) => `${l.name}@${l.weight}`).join("，") || "—"],
    ["状态", STATUS_LABEL[task.status] ?? task.status],
  ];

  const logs = (task.logs as any[]) ?? [];
  const LOG_STYLE: Record<string, string> = {
    info: "text-muted",
    progress: "text-primary",
    warn: "text-amber-500",
    error: "text-red-500",
    success: "text-emerald-500",
  };

  return (
    <div className="py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">作品详情</h1>
        <ButtonLink href="/create" size="sm" variant="outline">
          再生成
        </ButtonLink>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {task.images.length === 0 ? (
            <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-border text-muted">
              {task.status === "FAILED" ? task.error ?? "生成失败" : "暂无结果"}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {task.images.map((im) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={im.id} href={im.localPath} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={im.localPath}
                    alt="result"
                    className="aspect-square w-full rounded-xl border border-border object-cover transition-transform hover:scale-[1.02]"
                  />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Provenance / 溯源 */}
        <aside className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-muted">生成信息溯源</h2>
          <dl className="space-y-3 text-sm">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="mt-0.5 break-words text-ink">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-muted">创建时间</dt>
              <dd className="mt-0.5 text-ink">
                {new Date(task.createdAt).toLocaleString("zh-CN")}
              </dd>
            </div>
          </dl>
          <div className="mt-5 rounded-xl bg-subtle p-3 text-xs text-muted">
            本作品由本机 ComfyUI 与本地模型生成，数据保留在你的设备上。
          </div>
          <Link
            href="/me/works"
            className="mt-3 block text-center text-sm text-primary hover:underline"
          >
            在我的作品中查看
          </Link>
        </aside>
      </div>

      {/* Execution log */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          执行日志 · 工作流 {workflowLabel}
        </h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted">暂无日志</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-bg p-3 font-mono text-xs leading-relaxed">
            {logs.map((l: any, i: number) => (
              <div key={i} className={LOG_STYLE[l.level] ?? "text-muted"}>
                <span className="mr-2 text-muted/60">
                  {new Date(l.t).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
                {l.msg}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
