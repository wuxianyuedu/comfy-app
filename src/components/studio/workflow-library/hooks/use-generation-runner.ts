"use client";

/* ── 画布节点预览的「就地生成」运行器 ──
 *
 * 「提交 → SSE → 进度 → 产物 → 终态」是一条完整的状态机，不是 UI 的一部分：
 * 相位（Phase）、结果图与两条订阅路径都收在这里，视图只读相位渲染。
 *
 * 两条订阅路径共用**同一组回调**（{@link WorkflowRunHandlers}）：
 * • 发起路径 —— {@link executeRun} 里 `watchWorkflowRun(taskId, handlers)`；
 * • 恢复路径 —— {@link useWorkflowRunResume} 在重开窗口 / 切回页签时按
 *   登记表重订阅（服务端回放补齐历史帧）。
 * 此前两组回调各写一份（onProgress 的节流、onOutput 的产物捕获、onSettled
 * 的终态迁移逐字相同），收成一份后行为不可能再分叉。
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { createThrottleGate } from "~/components/ui/use-throttled-progress";
import { errorMessage } from "~/lib/error-message";
import {
  startLocalGenerate,
  type TaskProgressNode,
} from "~/lib/workshop/generation-client";
import {
  applyParamMapping,
  buildParamEntries,
  parseParamMapping,
} from "~/lib/workflow/workflow-param-mapping";
import {
  appendWorkflowRunLog,
  registerWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
import {
  toWorkflowInputsPayload,
  type WorkflowIOMap,
} from "~/components/studio/workflow-io";
import { seedModeOverrides } from "~/components/studio/project-canvas/CanvasNode/helpers";

import {
  useWorkflowRunResume,
  watchWorkflowRun,
  type WorkflowRunHandlers,
} from "./use-workflow-run-resume";

export type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; pct: number; node?: TaskProgressNode }
  | { kind: "done"; imageUrl?: string }
  | { kind: "failed"; message: string };

/** 当前时间戳（毫秒）。
 *
 *  抽成模块级函数而不是在组件体里直接 `Date.now()`：React 的纯度检查会顺着
 *  组件作用域内的调用点判定「渲染期调用了非纯函数」，而这里其实只在**点击运行
 *  的事件回调**里执行（永远不会在渲染期跑到）。由列出的这个事实源统一取时间，
 *  也方便将来在测试里打桩。 */
function nowMs(): number {
  return Date.now();
}

/** 发起一次运行所需的全部参数（容器组装；运行器只管状态机与订阅）。 */
interface RunPayload {
  workflowId: string;
  workflowName: string;
  taskType: string;
  workflowIO: WorkflowIOMap | null;
  effectiveMode: string | null;
  values: Record<string, unknown>;
  /** 载荷按**映射表**组装（不是裸的「暴露 pin 全量下发」）——
   *  生效映射（含本地 overlay）由容器的 `useParamWiring` 持有。 */
  effectiveParamMap: Record<string, unknown>;
  seedModes: Record<string, string>;
}

/** 组装运行期载荷并提交到本机生成，订阅 SSE 直到落定。
 *
 *  seed「控件后行为」与画布运行同源；映射还没就绪时退回原路径
 *  （直接把表单值打包成 inputs，由 ComfyUI 侧工作流自带默认值兜底）。 */
async function executeRun(
  payload: RunPayload,
  run: {
    setPhase: (p: Phase) => void;
    handlers: WorkflowRunHandlers;
  },
) {
  const {
    workflowId,
    workflowName,
    taskType,
    workflowIO,
    effectiveMode,
    values,
    effectiveParamMap,
    seedModes,
  } = payload;
  const { setPhase, handlers } = run;
  setPhase({ kind: "starting" });
  try {
    const mapped = workflowIO
      ? applyParamMapping({
          io: workflowIO,
          entries: buildParamEntries(workflowIO, undefined, {
            mode: effectiveMode,
          }),
          mapping: parseParamMapping(effectiveParamMap),
          values,
          mode: effectiveMode,
        })
      : null;
    const workflowInputs =
      mapped && mapped.inputs.length > 0
        ? mapped.inputs
        : toWorkflowInputsPayload(workflowIO ?? undefined, values);
    const cagInputs = seedModeOverrides(workflowIO ?? null, seedModes);
    const taskId = await startLocalGenerate({
      workflow: workflowId,
      workflowInputs: [...workflowInputs, ...cagInputs],
    });
    setPhase({ kind: "running", pct: 0 });
    registerWorkflowRun({
      taskId,
      workflowId,
      workflowName,
      taskType,
      startedAt: nowMs(),
      status: "running",
      source: "canvas-node",
    });
    await new Promise<void>((resolve) => {
      /* onSettled 在共享回调里只做终态迁移；发起路径还要借此结束本次
       * await（恢复路径没有这一层等待），所以在这里包一层。 */
      watchWorkflowRun(taskId, {
        ...handlers,
        onSettled: (id, result) => {
          handlers.onSettled(id, result);
          resolve();
        },
      });
    });
  } catch (e) {
    setPhase({ kind: "failed", message: errorMessage(e, String(e)) });
  }
}

/**
 * 生成运行的相位状态机（供 <WorkflowCanvasNodePreview> 使用）。
 *
 * @param enabled —— 除「已在运行」外的可运行条件（只读消费方 / 必填未填 /
 *   不在「实际使用」页签）。最终 `canRun = enabled && !running`。
 * @returns `startRun` —— 发起一次运行；载荷由容器组装（见 {@link RunPayload}），
 *   这样「生效映射」等容器侧派生不必倒灌进本 hook（否则与 `useParamWiring`
 *   的回调依赖会互相成环）。
 */
export function useGenerationRunner(params: {
  workflowId: string;
  enabled: boolean;
}) {
  const { workflowId, enabled } = params;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /* 节点相位的节流闸门（`~/components/ui/use-throttled-progress`）。
   * 发起与恢复两条订阅路径共用同一个闸门 —— 按任务分窗，不会互相挤掉。 */
  const progressGate = useRef(createThrottleGate());
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // onOutput 与 onSettled 都来自同一 SSE 闭包，state 读取会拿到渲染期旧值——
  // 用 ref 保证 onSettled 能看到 onOutput 刚写入的结果图。
  const resultUrlRef = useRef<string | null>(null);

  /* 用户修改输入值或对外参数连线后，上一次失败的 banner/状态点应自动清空，
   *  让「用此工作流生成」按钮回到可再次点击的 idle 状态。失败态只保留到用户
   *  采取行动前，避免「已经改过了还是显示失败」的错觉。 */
  const clearFailure = useCallback(() => {
    setPhase((p) => (p.kind === "failed" ? { kind: "idle" } : p));
  }, []);

  /* 发起与恢复共用的 SSE 回调（见文件头）。 */
  const handlers = useMemo<WorkflowRunHandlers>(
    () => ({
      onProgress: (taskId, pct, node) => {
        /* 高频回调：按任务节流（规范 16 §16.2.4.68）。 */
        if (!progressGate.current.allow(taskId)) return;
        setPhase({ kind: "running", pct, ...(node ? { node } : {}) });
      },
      onLog: (taskId, entry) => {
        appendWorkflowRunLog(taskId, entry);
      },
      onOutput: (_taskId, output) => {
        if (output.kind === "image" && output.url) {
          resultUrlRef.current = output.url;
          setResultUrl(output.url);
        }
      },
      onSettled: (_taskId, result) => {
        if (result.ok) {
          setPhase({
            kind: "done",
            imageUrl: resultUrlRef.current ?? undefined,
          });
        } else {
          setPhase({ kind: "failed", message: result.message ?? "生成失败" });
        }
      },
    }),
    [],
  );

  /* 重开窗口 / 切回本页签时的运行视角恢复：还在跑就重订阅 SSE（服务端回放
   * 补齐历史帧），已完成直接恢复产物、已失败恢复原因。**三态都要恢复** ——
   * 此前这里只认「还在跑」那一支，于是生成结束后切回来，产物与终态双双丢失
   * （用户实测：「生成结束后也看不到产出内容」）。不自动弹全屏日志（避免
   * 打断用户），由用户点「执行日志」查看。 */
  useWorkflowRunResume({
    workflowId,
    source: "canvas-node",
    handlers,
  });

  const running = phase.kind === "running" || phase.kind === "starting";
  const canRun = enabled && !running;

  const startRun = useCallback(
    (payload: RunPayload) => {
      void executeRun(payload, { setPhase, handlers });
    },
    [handlers],
  );

  return { phase, running, canRun, resultUrl, startRun, clearFailure };
}
