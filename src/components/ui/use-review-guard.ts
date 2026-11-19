"use client";

// 「AI 评审」类在途异步的作废守卫 + 就地错误文案（§16.2.4.34 的复用形，#2918 收尾批提取）。
// 镜头 / 角色卡 / 剧本三份评审 hook 共享同一内核：弹窗可能在 LLM 返回前被关闭或切换目标，那一轮
// 结果（无论成败）都不该落到界面上 —— 每次发起换一把 `beginStaleRun` 守卫，卸载时作废当前这把；
// 失败统一经守卫写就地错误文案，成功路径各不相同、留在各 hook 自己 `guard.commit`。
import { useCallback, useEffect, useRef, useState } from "react";

import { beginStaleRun, type StaleRunGuard } from "~/lib/stale-run";

export type ReviewGuard = {
  /** 开新一轮评审：作废旧守卫、清空就地错误，返回本轮守卫。 */
  begin: () => StaleRunGuard;
  /** 清空就地错误（reset 时调用）。 */
  clearError: () => void;
  /** 评审失败文案（就地展示，不外抛）。 */
  error: string;
  /** 守卫内写失败文案（守卫已作废则不落）。 */
  fail: (guard: StaleRunGuard, error_: unknown, fallback: string) => void;
};

export function useReviewGuard(): ReviewGuard {
  const [error, setError] = useState("");
  const guardRef = useRef<StaleRunGuard>(beginStaleRun());
  useEffect(() => {
    const guard = guardRef.current;
    return () => {
      guard.dispose();
    };
  }, []);

  const begin = useCallback(() => {
    guardRef.current.dispose();
    const guard = beginStaleRun();
    guardRef.current = guard;
    setError("");
    return guard;
  }, []);

  const fail = useCallback((guard: StaleRunGuard, error_: unknown, fallback: string) => {
    guard.commit(() => {
      setError(error_ instanceof Error ? error_.message : fallback);
    });
  }, []);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  return { begin, clearError, error, fail };
}
