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

const STORAGE_KEY = "comfyapp.updateCheck.enabled";
const MANUAL_SHORTCUT = "检测本地更新 (Ctrl+Shift+U)";

function readEnabledDefault(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

function summaryOf(groups: { key: string; label: string; files?: string[] }[]): string {
  return groups
    .map((g) => {
      const detail = g.files && g.files.length > 0 ? `（${g.files.slice(0, 3).join("、")}${g.files.length > 3 ? "…" : ""}）` : "";
      return `${g.label}${detail}`;
    })
    .join("；");
}
/** 生成全屏消息正文：逐组列出改动的文件清单（比 toast 概要更全）。 */
function bodyOf(groups: { key: string; label: string; hint?: string; files?: string[] }[]): string {
  const parts = groups.map((g) => {
    const head = `${g.label}${g.hint ? `（${g.hint}）` : ""}`;
    const files = g.files && g.files.length > 0 ? `
  · ${g.files.join("\n  · ")}` : "";
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
        toast.info("检测到本地更新", `${summaryOf(groups)}。需重启应用才生效。`);
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
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      /* localStorage 不可用则仅内存态生效 */
    }
  }, [enabled]);

  // 把手动检测注册给共享 store（导航栏按钮经 store 触发）
  useEffect(() => {
    registerManual(checkNow);
    return () => registerManual(null);
  }, [checkNow, registerManual]);

  // 快捷键 Ctrl+Shift+U 主动检测一次：无脏态时给「已是最新」的确定性反馈
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        void (async () => {
          const ok = await checkNow();
          if (ok) {
            const dirty = useUpdateCheckStore.getState().dirty;
            const groups = useUpdateCheckStore.getState().groups;
            if (!dirty) {
              toast.info(MANUAL_SHORTCUT, "本地文件无需重启的改动。");
            } else {
              toast.info(MANUAL_SHORTCUT, `检测到需重启的改动：${summaryOf(groups)}`);
            }
          }
        })();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [checkNow, toast]);

  return null;
}
