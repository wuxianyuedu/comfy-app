"use client";

/**
 * 本地更新检测分区（规范 17 §17.2 第③层）。桌面壳下源码热更归 dev server，只有
 * 「改完须重启才生效」的文件（Rust / tauri.conf.json / splash / .env / pnpm 配置）在运行期检测；
 * 结果由 `update-check-store` 承载，视图只自持「本次手动检测的提示文案」。
 */

import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { useUpdateCheckStore } from "~/components/update-check/update-check-store";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Spinner } from "~/components/ui/spinner";

import { SettingsCard } from "~/components/ui/settings-card";
import { FieldLabel } from "~/components/ui/field";

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
    <SettingsCard title="本地更新检测">
      <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
        桌面壳开着时，本地源码由 dev server 自动热更（无需提示）。仅当
        <strong className="text-ink/80">改完当前窗口不生效、得重启</strong>
        的文件（Rust 源码 / tauri.conf.json / splash.html —— 需重编壳； .env / pnpm 配置 /
        package.json —— 需重启应用）在运行期被改动时， 应用内 toast 提示。按 Ctrl+Shift+U
        可随时手动检测一次。
      </p>
      <div className="mb-3 flex items-center gap-2">
        <Checkbox
          checked={updateCheckEnabled}
          id="local-update-check-enabled"
          onCheckedChange={(next) => {
            useUpdateCheckStore.getState().setEnabled(next === true);
          }}
        />
        <FieldLabel className="text-ink/80 text-sm" htmlFor="local-update-check-enabled">
          开启运行期「本地更新需重启」检测
        </FieldLabel>
      </div>
      <div className="border-border bg-surface-1 mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
        <Button
          className="text-primary h-auto items-center gap-1.5 p-0 font-medium"
          disabled={checking}
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void handleManualCheck()}
          variant="link"
        >
          {checking ? (
            <Spinner className="size-3.5" />
          ) : (
            <ArrowLeft className="rotate-90" data-icon="inline-start" size={14} />
          )}
          立即检测本地更新
        </Button>
        <span className="text-muted-foreground text-xs">
          {manualStatus ?? (dirty ? "存在需重启的改动" : "未检测到需重启的改动")}
        </span>
      </div>
    </SettingsCard>
  );
}
