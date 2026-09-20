"use client";

/* ── 本地更新检测的挂载容器（根布局只挂一次，渲染空节点）────────
 * 职责：从 localStorage 水合轮询开关、把开关与手动检测注册到共享 store
 * （供导航栏按钮等非嵌套 chrome 触发）、监听 Ctrl+Shift+U 主动检测、
 * 在检测到「需重启才生效」的改动时用应用内 toast 提示（安静、不抢焦点）。
 * 真正的轮询/网络在 ~/components/update-check/hooks/use-update-check.ts。
 */

import { useCallback, useEffect } from "react";

import { useToast } from "~/components/studio/ToastProvider";
import { useMessageCenterStore } from "~/components/message-center/message-center-store";
import { useUpdateCheckStore } from "./update-check-store";
import { useUpdateCheck } from "./hooks/use-update-check";
import { useHotkey } from "~/components/ui/use-hotkey";
import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";

const STORAGE_KEY = "comfyapp.updateCheck.enabled";
const MANUAL_SHORTCUT = "检测本地更新 (Ctrl+Shift+U)";

function readEnabledDefault(): boolean {
  /* 「读不到 = 从未设置过」→ 默认开启；读到 `"0"` 才关闭（§16.2.4.28）。
   * 此前这里**不判 SSR**、只靠 try/catch 兜住 `window` 不存在时的异常 ——
   * 兜是兜住了，但判据与另外几处不同（那几处判 `typeof window`）。 */
  return readStorageItem(STORAGE_KEY) !== "0";
}

function summaryOf(
  groups: { key: string; label: string; files?: string[] }[],
): string {
  return groups
    .map((g) => {
      const detail =
        g.files && g.files.length > 0
          ? `（${g.files.slice(0, 3).join("、")}${g.files.length > 3 ? "…" : ""}）`
          : "";
      return `${g.label}${detail}`;
    })
    .join("；");
}
/** 生成全屏消息正文：逐组列出改动的文件清单（比 toast 概要更全）。 */
function bodyOf(
  groups: { key: string; label: string; hint?: string; files?: string[] }[],
): string {
  const parts = groups.map((g) => {
    const head = `${g.label}${g.hint ? `（${g.hint}）` : ""}`;
    const files =
      g.files && g.files.length > 0
        ? `
  · ${g.files.join("\n  · ")}`
        : "";
    return `${head}${files}`;
  });
  return `检测到需重启应用才生效的本地改动：\n\n${parts.join("\n")}\n\n请重启应用以让改动生效。`;
}

export function UpdateCheckProvider() {
  const toast = useToast();
  const setEnabled = useUpdateCheckStore((s) => s.setEnabled);
  const registerManual = useUpdateCheckStore((s) => s.registerManual);

  const { checkNow } = useUpdateCheck({
    onDirty: useCallback(
      (groups) => {
        toast.info(
          "检测到本地更新",
          `${summaryOf(groups)}。需重启应用才生效。`,
        );
        // 同步收进消息中心，未读计数 +1，避免 toast 一闪而过无处回看
        useMessageCenterStore.getState().push({
          kind: "update",
          title: "检测到本地更新，需重启应用",
          body: bodyOf(groups),
        });
      },
      [toast],
    ),
  });

  // 水合：首次挂载从 localStorage 读取开关
  useEffect(() => {
    setEnabled(readEnabledDefault());
  }, [setEnabled]);

  // 持久化：开关变化时写回 localStorage
  const enabled = useUpdateCheckStore((s) => s.enabled);
  useEffect(() => {
    /* localStorage 不可用则仅内存态生效（写失败已静默）。 */
    writeStorageItem(STORAGE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  // 把手动检测注册给共享 store（导航栏按钮经 store 触发）
  useEffect(() => {
    registerManual(checkNow);
    return () => registerManual(null);
  }, [checkNow, registerManual]);

  /* 快捷键 ⌘/Ctrl+Shift+U 主动检测一次：无脏态时给「已是最新」的确定性反馈。
   * 此前只判 `ctrlKey` —— macOS 上按 ⌘ 没有任何反应（Issue 的一次收口）。 */
  const checkFromShortcut = useCallback(() => {
    void (async () => {
      const ok = await checkNow();
      if (!ok) return;
      const { dirty, groups } = useUpdateCheckStore.getState();
      if (!dirty) {
        toast.info(MANUAL_SHORTCUT, "本地文件无需重启的改动。");
      } else {
        toast.info(MANUAL_SHORTCUT, `检测到需重启的改动：${summaryOf(groups)}`);
      }
    })();
  }, [checkNow, toast]);
  useHotkey({ key: "u", mod: true, shift: true }, checkFromShortcut);

  return null;
}
