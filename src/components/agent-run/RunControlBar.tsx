"use client";

// AI 自主执行 run 的控制条（Phase 6 · P6-3）——画布 / 工坊两处共用的「暂停与审批」操作台。
//
// 只做展示 + 把点击上抛给`useAgentRun`（IO/轮询都在 hook）。按 run.status 呈现不同操作：
// 未启动=填目标+选审批粒度+启动；执行中=下一步提示+暂停/取消；等待确认=点头继续/暂停/取消；
// 已暂停=继续/取消；完成/失败/取消=状态+重新开始。复用 Button/Badge/Textarea（不自造原语）。
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Textarea } from "~/components/ui/textarea";
import { textHandler } from "~/lib/form-props";
import { useAgentRun, type AgentRunController } from "./use-agent-run";
import type {
  ApprovalMode,
  RunAction,
  RunStatus,
} from "~/lib/production/run-types";

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: "未启动",
  running: "执行中",
  awaiting_approval: "等待确认",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_BADGE: Record<
  RunStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  idle: "outline",
  running: "default",
  awaiting_approval: "secondary",
  paused: "secondary",
  done: "default",
  failed: "destructive",
  cancelled: "outline",
};

function actionLabel(action: RunAction): string {
  switch (action.kind) {
    case "generate_script":
      return "生成剧本";
    case "extract_characters":
      return "提取角色";
    case "plan_storyboard":
      return "规划分镜";
    case "render_images":
      return `逐镜生图（${action.shotIds.length} 个镜头）`;
    case "render_film":
      return "生成视频并合成成片";
    case "await_approval":
      return "等待你确认这一步";
    case "done":
      return "全部完成";
    default:
      return "待启动";
  }
}

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string }[] = [
  { value: "stage", label: "每阶段确认" },
  { value: "shot", label: "逐镜确认" },
  { value: "auto", label: "全自动跑完" },
];

/** 日志时间戳 → 本地时分秒；解析失败给空串。 */
function formatStepTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

export function RunControlBar() {
  return <RunControlBarView c={useAgentRun()} />;
}

/** 纯展示部分（单独导出便于按状态直接单测，不必跑真实 hook）。 */
export function RunControlBarView({ c }: { c: AgentRunController }) {
  if (!c.projectId) return null;
  const { run } = c;
  const busy = c.busy;

  return (
    <div className="border-border-subtle bg-panel z-base flex flex-col gap-2 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-ink-field text-[13px] font-semibold">
          AI 自主成片
        </span>
        <Badge variant={STATUS_BADGE[run.status]}>
          {STATUS_LABEL[run.status]}
        </Badge>
        {run.status === "running" || run.status === "awaiting_approval" ? (
          <span className="text-ink-fainter text-[12px]">
            下一步：{actionLabel(c.action)}
          </span>
        ) : null}
      </div>

      {/* 执行日志：引擎每步一条（最新在上），让「AI 跑到哪、产出了什么」在应用内可见。 */}
      {run.log.length > 0 && (
        <ul
          className="border-border-subtle bg-canvas/50 flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border px-2.5 py-1.5"
          aria-label="执行日志"
        >
          {[...run.log].reverse().map((step) => (
            <li
              key={step.ts}
              className="text-ink-fainter flex items-baseline gap-1.5 text-[11px]"
            >
              <span
                className={step.ok ? "text-emerald-500" : "text-destructive"}
                aria-hidden
              >
                {step.ok ? "✓" : "✗"}
              </span>
              <span className="text-ink-faintest shrink-0 tabular-nums">
                {formatStepTime(step.ts)}
              </span>
              <span className="min-w-0">{step.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {(run.status === "idle" ||
        run.status === "done" ||
        run.status === "failed" ||
        run.status === "cancelled") && (
        <div className="flex flex-wrap items-end gap-2">
          <Textarea
            value={c.goal}
            onChange={textHandler(c.setGoal)}
            rows={2}
            placeholder="想拍什么？一句话创意即可（留空则用项目标题）"
            className="border-border bg-subtle text-ink-field max-w-md min-w-[220px] flex-1 resize-none text-[12px]"
          />
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-ink-faint">确认粒度</span>
            <select
              value={c.approvalMode}
              onChange={textHandler((v) =>
                c.setApprovalMode(v as ApprovalMode),
              )}
              className="border-border bg-subtle text-ink-field h-9 rounded-lg border px-2 text-[12px]"
            >
              {APPROVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="border-border bg-subtle text-ink-field flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[12px]">
            <Checkbox
              checked={c.autoReview}
              onCheckedChange={(checked) => c.setAutoReview(checked === true)}
            />
            <span>生图后自动评审</span>
          </label>
          <Button
            type="button"
            size="sm"
            onClick={() => void c.start()}
            disabled={busy}
            className="h-9"
          >
            {run.status === "idle" ? "启动" : "重新开始"}
          </Button>
        </div>
      )}

      {run.status === "running" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void c.pause()}
            disabled={busy}
          >
            暂停
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void c.cancel()}
            disabled={busy}
          >
            取消
          </Button>
        </div>
      )}

      {run.status === "awaiting_approval" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void c.approve()}
            disabled={busy}
          >
            确认，继续
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void c.pause()}
            disabled={busy}
          >
            暂停
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void c.cancel()}
            disabled={busy}
          >
            取消
          </Button>
        </div>
      )}

      {run.status === "paused" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void c.resume()}
            disabled={busy}
          >
            继续
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void c.cancel()}
            disabled={busy}
          >
            取消
          </Button>
        </div>
      )}

      {run.status === "failed" && run.error ? (
        <p className="text-destructive text-[12px]">{run.error}</p>
      ) : null}
      {c.error ? (
        <p className="text-destructive text-[12px]">{c.error}</p>
      ) : null}
    </div>
  );
}
