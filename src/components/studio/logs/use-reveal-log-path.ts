"use client";

// ── 「点日志里的路径」的执行态与反馈（日志行的第②层）────────────────────────
//
// 日志行里的路径是可点的（ISSUE #1365），而这个动作有三个**必须**由逻辑层管的
// 东西，视图不该自己拼：
//
//   1. **重入**：连点两下会发两次「打开文件管理器」，第二次往往拿到一句自相矛盾的
//      反馈（资源管理器已在处理）。判据走 `useReentrancyLock` 的同步 ref，而不是读
//      `busy` state —— 同一次事件循环里 `setBusy(true)` 还没提交（规范 16 §16.2.4.69）。
//   2. **反馈**：成功与失败都要说，而且**失败必须说**（硬规则 4）。日志行是密集列表，
//      没有地方挂常驻说明，所以反馈跟着按钮自己走（与行内复制按钮同一套口径）：
//      成功「已定位」、失败「打开失败」并把原因放进 Hint。
//   3. **按行独立**：一行一个按钮，连点不同行不该互相覆盖对方的回执。
//
// 与 `use-external-action` 的关系：那个出口管「把控制权交给外部程序」的**通用**样板
// （空目标拦截 / 结果归一 / 失败文案），它的三种目标（browser / folder / update）
// 都对应具名端点。这里**没走它**是因为两件事不同：① 目标不是「一个 URL / 一个目录」
// 而是一段**待解析的候选文本**（最长存在前缀要问磁盘）；② 失败文案不能由目标类别
// 拼出来 —— 它要带上「是哪个候选没找到」。硬套会让那个出口长出一个只有本处用的分支。

import { useCallback, useState } from "react";

import { revealLogPath } from "~/lib/log/log-reveal-client";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

/** 一条路径的打开结果（只保留要显示的那两件）。 */
export interface RevealPathFeedback {
  /** 这一刻这一次打开是不是在跑（给按钮的禁用 / 文案用）。 */
  busy: boolean;
  /** 上一次的结果：成功 / 失败 / 还没试过。 */
  outcome: "idle" | "done" | "failed";
  /** 上一次失败的说明（成功时为空；由服务端给，可直接显示）。 */
  failure: string;
  /** 打开这个路径。 */
  reveal: (path: string) => void;
}

/**
 * 一行日志里一个路径的打开动作。
 *
 * **每个路径一个 hook 实例**（在行内按候选渲染时各持一份），反馈因此天然按路径
 * 独立；连点同一处由同步重入锁挡住。
 */
export function useRevealLogPath(
  onOutcome?: (outcome: "done" | "failed") => void,
): RevealPathFeedback {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"idle" | "done" | "failed">("idle");
  const [failure, setFailure] = useState("");
  const lock = useReentrancyLock();

  const reveal = useCallback(
    (target: string) => {
      if (!lock.tryEnter()) return;
      setBusy(true);
      setOutcome("idle");
      setFailure("");
      void revealLogPath(target)
        .then((result) => {
          /* 成败都改口（§16.2.4.43）：只在成功时改口同样是撒谎的另一半 ——
           * 用户连点几次都没反应，会以为按钮坏了。 */
          setOutcome(result.ok ? "done" : "failed");
          if (!result.ok) setFailure(result.detail);
          onOutcome?.(result.ok ? "done" : "failed");
        })
        .finally(() => {
          lock.exit();
          setBusy(false);
        });
    },
    [lock, onOutcome],
  );

  return { busy, outcome, failure, reveal };
}
