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

/**
 * useExternalAction —— 「触发一次外部动作」的**执行态样板**的唯一出口
 * （规范 16 §16.2.4.25）。
 *
 * 为什么收口：全库有 **9 处**各写一份逐字同形的样板 ——
 * 「置忙 → 「调用 → 按结果字段报成功/失败」→ 「catch 里用 `errorMessage`
 * 拼一句失败文案」→ finally 清忙」。而**判据各不相同**：
 *
 * | 差异 | 收口前 |
 * | --- | --- |
 * | 结果字段 | `openExternal` / `comfyOpen` / `dbStudioOpen` 读 `ok`；更新器读 `triggered` |
 * | 空目标拦截 | 只有 `openExternalUrl` 一处拦了空串（其余把空值直接发给服务端，拿到 zod 的英文报错） |
 * | 失败文案 | 每处手写一句「打开 XXX 失败」，措辞不统一 |
 * | 防重入 | 有的用 `useState` 忙标记，有的（`checkAppUpdate` / `installAppUpdate`）用「busy 不是 idle 就直接 return」 |
 *
 * 也就是说 —— **「这个动作失败了界面说不说、说什么」取决于它是哪一处写的**。
 *
 * ## 三件本 hook 一次给全的事
 *
 * 1. **空目标在发起 IO 之前拦**，用 `~/lib/external-open` 的 `emptyTargetText`
 *    给出可读文案（服务端校验层的报错不该是用户看到的第一句话）；
 * 2. **结果归一**：`ok` / `triggered` 的形状差异在 `toExternalResult` 里吃掉，
 *    调用处只面对一个 `{ ok, detail }`；
 * 3. **忙着的时候不并发第二次**（`busy` 为真时直接返回）—— 「双击打开目录」
 *    此前会发出两次请求，第二次拿到的往往是「目录已在打开中」这种自相矛盾的
 *    反馈（`openFolderBusy` 只把按钮置灰，键盘 Enter 仍能触发第二次）。
 *
 * ## 反馈通道由调用处注入
 *
 * 设置页用整页提示条（`showFlash`），历史详情用 `toast`，画布用 toast ——
 * **这是调用处的表现层选择**，不是本 hook 的判据。所以 `report` 由调用处给，
 * 本 hook 只负责「什么时候报、报什么」。
 */
export interface ExternalActionOptions {
  /** 动作目标类别（决定失败文案里的动词，`~/lib/external-open`）。 */
  target: ExternalTarget;
  /**
   * 反馈通道。`kind` 为 `"ok"` / `"err"`，`detail` 是**已经归一化并翻译过**的
   * 可读文案 —— 调用处直接渲染即可，不必再判一次。
   */
  report: (kind: "ok" | "err", detail: string) => void;
}

export interface ExternalActionResult {
  /** 当前是否正在执行（调用处据此禁用按钮 / 显示「打开中…」）。 */
  busy: boolean;
  /**
   * 执行一次外部动作。
   *
   * @param run 真正发起 IO 的函数，返回**任意形状**的结果（`{ok,detail}` /
   *   `{triggered,detail}` / 直接给 detail 都行 —— 归一交给 `toExternalResult`）。
   * @param guard 可选：发起之前的**域判据**。返回 `false` 时整段跳过（不报错、
   *   不进 busy），由调用处自己在 `guard` 里给出说明。用于「地址要先探一次」这类
   *   落点（`openComfyInBrowser` 要先 `refetch` 判断是否在运行）。
   */
  run: (
    action: () => Promise<{
      ok?: boolean;
      triggered?: boolean;
      detail?: string | null;
      error?: string | null;
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
      ok?: boolean;
      triggered?: boolean;
      detail?: string | null;
      error?: string | null;
    }>,
  ) => Promise<void>;
}

export function useExternalAction({
  target,
  report,
}: ExternalActionOptions): ExternalActionResult {
  const [busy, setBusy] = useState(false);
  /* 重入判据收在唯一出口里（规范 16 §16.2.4.69）—— 用同步 ref 而不是读
   * `busy` 状态：同一次事件循环里连点两下时，`setBusy(true)` 还没提交，
   * 第二次调用读到的 `busy` 仍是 `false`，那正是「双击发两次请求」的成因。
   * 忙碌位仍然由本 hook 持有（界面要用），两者是两件事。 */
  const lock = useReentrancyLock();

  const run = useCallback<ExternalActionResult["run"]>(
    async (action, guard) => {
      if (!lock.tryEnter()) return;
      setBusy(true);
      try {
        if (guard && !(await guard())) return;
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
      if (isEmptyTarget(value)) {
        report("err", emptyTargetText(target));
        return;
      }
      await run(() => action(value!));
    },
    [report, run, target],
  );

  return { busy, run, runWithTarget };
}
