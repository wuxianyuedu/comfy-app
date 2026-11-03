"use client";

// ── 「点日志里的路径」的执行态与反馈（第②层，ISSUE #1365）──────────────────
// 必须由逻辑层管三件事：① 重入——`useReentrancyLock` 的同步 ref（不能读 `busy` state，
//    同一事件循环里 setBusy(true) 尚未提交）；② 反馈成功「已定位」/失败「打开失败」，
//    失败必须说（硬规则 4），且按行独立不互相覆盖。
// 未走 `use-external-action`：目标是待解析候选文本，失败文案要带「哪个候选没找到」。

import { useCallback, useState } from "react";

import { revealLogPath } from "~/lib/log/log-reveal-client";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

/** 一条路径的打开结果（只保留要显示的那两件）。 */
export type RevealPathFeedback = {
  /** 这一刻这一次打开是不是在跑（给按钮的禁用 / 文案用）。 */
  busy: boolean;
  /** 上一次失败的说明（成功时为空；由服务端给，可直接显示）。 */
  failure: string;
  /** 上一次的结果：成功 / 失败 / 还没试过。 */
  outcome: "idle" | "done" | "failed";
  /** 打开这个路径。 */
  reveal: (path: string) => void;
};

/**
 * 一行日志里一个路径的打开动作。
 * 每个路径一个 hook 实例（行内按候选各持一份），反馈天然按路径独立；
 * 连点同一处由同步重入锁挡住。
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
      if (!lock.tryEnter()) {
        return;
      }
      setBusy(true);
      setOutcome("idle");
      setFailure("");
      void revealLogPath(target)
        .then((result) => {
          /* 成败都改口（§16.2.4.43）：只在成功时改口同样是撒谎的另一半 ——
           * 用户连点几次都没反应，会以为按钮坏了。 */
          setOutcome(result.ok ? "done" : "failed");
          if (!result.ok) {
            setFailure(result.detail);
          }
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
