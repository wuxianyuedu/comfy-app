"use client";

/* 工作流库的**执行日志入口按钮**。
 *
 * 「画布节点」与「工坊封装」两个页签在跑同一条封装口径的工作流，运行登记表
 * 是一份（按来源标记区分）。入口现在下沉到**各页签这一排**，各自带 `source`
 * 过滤（ISSUE #611 的旧形态是「两个页签各写各的」）。按钮只做「有没有可看的
 * 运行 → 显示入口与状态摘要」这一件事，点击上抛打开全屏日志弹窗
 * （`WorkflowRunLogModal`）。运行数据来自共享的 `workflow-run-store`，不碰网络
 * （规范 §17.2 第③层）。 */

import { useMemo, useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { StatusDot } from "~/components/ui/status-dot";

import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
  type WorkflowRunSource,
} from "~/lib/workflow/workflow-run-store";

export interface WorkflowRunLogButtonProps {
  /** 只看当前工作流的运行记录。 */
  workflowId: string;
  /** 指定要展示状态摘要的那次运行（缺省取最近一次）。 */
  taskId?: string | null;
  /** 是否在跑（带呼吸点）。缺省时按运行登记表自动判定 —— 详情头部不绑定
   *  任何页签的运行，自己判才不会漏掉呼吸点。 */
  running?: boolean;
  /** 可选：只看某个来源的运行（缺省不限）。 */
  source?: WorkflowRunSource;
  /** 没跑过也渲染入口：详情头部那扇门位置固定，随时点得开（弹窗里显示空态
   *  「运行生成后此处会显示执行步骤日志」）。缺省 false = 有运行记录才出现。 */
  alwaysVisible?: boolean;
  onOpen: () => void;
}

export function WorkflowRunLogButton({
  workflowId,
  taskId,
  running,
  source,
  alwaysVisible = false,
  onOpen,
}: WorkflowRunLogButtonProps) {
  const snapshot = useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
  const runs = useMemo(
    () =>
      snapshot.runs.filter(
        (run) =>
          run.workflowId === workflowId && (!source || run.source === source),
      ),
    [snapshot.runs, workflowId, source],
  );
  if (runs.length === 0 && !alwaysVisible) return null;
  const active = taskId ? runs.find((run) => run.taskId === taskId) : runs[0];
  /* 呼吸点：调用方没指定（详情头部不绑定任何页签的运行）就按登记表自己判 ——
   * 该工作流还有没收尾的运行就算「在跑」。 */
  const live =
    running ??
    runs.some((run) => run.status !== "done" && run.status !== "failed");
  const statusText = active
    ? active.status === "done"
      ? "上次已完成"
      : active.status === "failed"
        ? "上次已失败"
        : "生成中…"
    : runs.length > 0
      ? `${runs.length} 次运行`
      : "暂无运行";

  return (
    <Hint label="打开执行日志">
      <Button
        variant="outline"
        onClick={onOpen}
        data-testid="wflib-log-open"
        /* 与同排的「导入画布 / 编辑 / 源文件 / 下载」同款描边按钮（`ActionButton`
         *  的 default 变体）：这一排按钮是一组动作，不要一个深底一个浅底。 */
        className="border-border bg-subtle text-ink-strong hover:bg-surface-2 hover:text-ink-bright text-2xs h-auto gap-1.5 rounded-lg px-2.5 py-1.5 font-medium"
      >
        <span className="text-ink-strong flex items-center gap-1.5 font-medium">
          执行日志
          {live && <StatusDot state="busy" sizeClass="size-1.5" pulse />}
        </span>
        <span className="text-ink-fainter text-[10.5px]">{statusText}</span>
      </Button>
    </Hint>
  );
}
