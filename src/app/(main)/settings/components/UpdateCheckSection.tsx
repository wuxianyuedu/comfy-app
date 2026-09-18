"use client";

/**
 * 本地更新检测分区（规范 17 §17.2 第③层）。
 *
 * 开着桌面壳时，源码热更由 dev server 负责；只有「改完当前窗口不生效、得重启」
 * 的文件（Rust / tauri.conf.json / splash / .env / pnpm 配置）在运行期变动才有意义，
 * 检测结果由 `update-check-store` 承载（Provider 在根布局注册与持久化）。
 *
 * 视图自持的仅「本次手动检测的提示文案」这一个交互态，其余读 store。
 */

import { ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";

import { useUpdateCheckStore } from "~/components/update-check/update-check-store";

import { Card } from "./SettingsPrimitives";

export function UpdateCheckSection() {
  const updateCheckEnabled = useUpdateCheckStore((s) => s.enabled);
  const dirty = useUpdateCheckStore((s) => s.dirty);
  const checking = useUpdateCheckStore((s) => s.checking);
  const [manualStatus, setManualStatus] = useState<string | null>(null);
  const handleManualCheck = async () => {
    setManualStatus("检测中…");
    const impl = useUpdateCheckStore.getState().manualImpl;
    const ran = impl ? await impl() : false;
    if (!ran) {
      setManualStatus("检测服务未就绪，稍后再试");
      return;
    }
    const st = useUpdateCheckStore.getState();
    setManualStatus(st.dirty ? "存在需重启的改动" : "未检测到需重启的改动");
  };

  return (
    <Card title="本地更新检测">
      <p className="text-muted-foreground mb-4 text-sm">
        桌面壳开着时，本地源码由 dev server 自动热更（无需提示）。仅当
        <strong className="text-ink/80">改完当前窗口不生效、得重启</strong>
        的文件（Rust 源码 / tauri.conf.json / splash.html —— 需重编壳； .env /
        pnpm 配置 / package.json —— 需重启应用）在运行期被改动时， 应用内 toast
        提示。按 Ctrl+Shift+U 可随时手动检测一次。
      </p>
      <div className="mb-3 flex items-center gap-2">
        <input
          id="local-update-check-enabled"
          type="checkbox"
          className="accent-primary size-4"
          checked={updateCheckEnabled}
          onChange={(event) =>
            useUpdateCheckStore.getState().setEnabled(event.target.checked)
          }
        />
        <label
          htmlFor="local-update-check-enabled"
          className="text-ink/80 text-sm"
        >
          开启运行期「本地更新需重启」检测
        </label>
      </div>
      <div className="border-border bg-surface-1 mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => void handleManualCheck()}
          className="text-primary hover:text-primary-hover inline-flex items-center gap-1.5 font-medium disabled:opacity-50"
          disabled={checking}
        >
          {checking ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowLeft size={14} className="rotate-90" />
          )}
          立即检测本地更新
        </button>
        <span className="text-muted-foreground text-xs">
          {manualStatus ??
            (dirty ? "存在需重启的改动" : "未检测到需重启的改动")}
        </span>
      </div>
    </Card>
  );
}
