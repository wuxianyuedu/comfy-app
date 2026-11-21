"use client";

// ── 测试模型 · 产物原链交给系统浏览器（#3791）────────────────────────────
// 桌面壳内 target=_blank 外链会被壳的 shell ACL 拦下，统一走服务端
// openExternal（免重编壳）。从 useModelTest 拆出（§12.13：主 hook 越过
// 函数长度硬闸，按职责拆子 hook）。

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";

import { useExternalAction } from "~/components/ui/use-external-action";
import { getBaseUrl } from "~/trpc/base-url";
import { useTRPC } from "~/trpc/react";

/** 对会话的写入面（只碰反馈位）。 */
type NoticePatch = { notice?: { kind: "ok" | "err"; text: string } | null };

export function useOpenResultInBrowser(args: {
  /** 当前格的键（ref 转发，保持回调身份稳定）。 */
  activeKeyRef: { current: string };
  patchSession: (key: string, patch: NoticePatch) => void;
}): {
  openBusy: boolean;
  openResultInBrowser: (url: string) => Promise<void>;
} {
  const trpc = useTRPC();
  const { activeKeyRef, patchSession } = args;
  const openExternalM = useMutation(trpc.setting.openExternal.mutationOptions());
  const openExternalAction = useExternalAction({
    target: "browser",
    report: (kind, text) => {
      patchSession(activeKeyRef.current, { notice: { kind, text } });
    },
  });
  const openResultInBrowser = useCallback(
    async (url: string) => {
      await openExternalAction.runWithTarget(url, (target) => {
        /* 本地工作流产物是同源相对路径（/api/generated/...），而 openExternal 的入参是
         * `z.url()` —— 相对路径当场 invalid_format（#4750），更后面 `isHttpUrl()` 也
         * 只收绝对 http(s)。按应用 origin 补成绝对 URL 再发（`getBaseUrl()` 是全库
         * origin 唯一出处）；已是绝对地址的原样保留，`file:` / `javascript:` 这类
         * 危险协议仍由服务端协议闸拦下 —— 这里只补 origin，不放宽任何安全边界。 */
        const absolute = new URL(target, getBaseUrl()).toString();
        return openExternalM.mutateAsync({ url: absolute });
      });
    },
    [openExternalAction, openExternalM],
  );
  return { openBusy: openExternalAction.busy, openResultInBrowser };
}
