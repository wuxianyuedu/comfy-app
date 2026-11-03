"use client";

import { useCallback, useState } from "react";

import {
  emptyTargetText,
  externalFailureText,
  isEmptyTarget,
  toExternalResult,
  type ExternalTarget,
} from "~/lib/external-open";
import { errorMessage } from "~/lib/error-message";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

/** useExternalAction —— 「触发一次外部动作」执行态样板的唯一出口（规范 16 §16.2.4.25）。收口前全库 9 处同形样板、判据各异：
 * 结果字段（`ok` vs `triggered`）、空目标拦截（只有 `openExternalUrl` 拦空串）、失败文案（各写一句「打开 XXX 失败」）、
 * 防重入（忙标记 vs「busy 不是 idle 就 return」）—— 于是「失败说不说、说什么」取决于写在哪处。本 hook 一次给全：
 * 空目标在 IO 前拦并给 `emptyTargetText`，`toExternalResult` 归一结果，`busy` 时不并发第二次；反馈通道由调用处注入。 */
export type ExternalActionOptions = {
  /**
   * 反馈通道。`kind` 为 `"ok"` / `"err"`，`detail` 是**已经归一化并翻译过**的
   * 可读文案 —— 调用处直接渲染即可，不必再判一次。
   */
  report: (kind: "ok" | "err", detail: string) => void;
  /** 动作目标类别（决定失败文案里的动词，`~/lib/external-open`）。 */
  target: ExternalTarget;
};

export type ExternalActionResult = {
  /** 当前是否正在执行（调用处据此禁用按钮 / 显示「打开中…」）。 */
  busy: boolean;
  /**
   * 执行一次外部动作。`run` 发起 IO，可返回任意形状的结果（归一交给 `toExternalResult`）；
   * `guard` 可选：发起之前的**域判据**，返回 `false` 时整段跳过（不报错、不进 busy），
   * 由调用处自己在 `guard` 里给出说明（如 `openComfyInBrowser` 要先 `refetch` 判断是否在运行）。
   */
  run: (
    action: () => Promise<{
      detail?: string | null;
      error?: string | null;
      ok?: boolean;
      triggered?: boolean;
    }>,
    guard?: () => Promise<boolean>,
  ) => Promise<void>;
  /**
   * 带**目标值**的便捷入口：空值时用 `emptyTargetText` 拦下（不进 busy、
   * 不发起 IO）。
   */
  runWithTarget: (
    target: string | null | undefined,
    action: (target: string) => Promise<{
      detail?: string | null;
      error?: string | null;
      ok?: boolean;
      triggered?: boolean;
    }>,
  ) => Promise<void>;
};

export function useExternalAction({ target, report }: ExternalActionOptions): ExternalActionResult {
  const [busy, setBusy] = useState(false);
  /* 重入判据收在唯一出口里（规范 16 §16.2.4.69）—— 用同步 ref 而不是读
   * `busy` 状态：同一次事件循环里连点两下时，`setBusy(true)` 还没提交，
   * 第二次调用读到的 `busy` 仍是 `false`，那正是「双击发两次请求」的成因。
   * 忙碌位仍然由本 hook 持有（界面要用），两者是两件事。 */
  const lock = useReentrancyLock();

  const run = useCallback<ExternalActionResult["run"]>(
    async (action, guard) => {
      if (!lock.tryEnter()) {
        return;
      }
      setBusy(true);
      try {
        if (guard && !(await guard())) {
          return;
        }
        const raw = await action();
        const result = toExternalResult(raw);
        report(result.ok ? "ok" : "err", result.detail);
      } catch (error) {
        report("err", errorMessage(error, externalFailureText(target)));
      } finally {
        lock.exit();
        setBusy(false);
      }
    },
    [lock, report, target],
  );

  const runWithTarget = useCallback<ExternalActionResult["runWithTarget"]>(
    async (value, action) => {
      /* 空目标在**发起 IO 之前**拦（见 hook 注释第 1 条）。这里刻意不设 busy：
       * 界面上的忙碌态表达的是「外部动作正在发起」，而这一步什么都没发起。 */
      /* `isEmptyTarget` 已把空目标挡在上面；这里把它换成显式的收窄判据，
       * 让「传进去的确实非空」与「上面判过」是同一件事。 */
      if (isEmptyTarget(value) || value === null || value === undefined) {
        report("err", emptyTargetText(target));
        return;
      }
      await run(() => action(value));
    },
    [report, run, target],
  );

  return { busy, run, runWithTarget };
}
