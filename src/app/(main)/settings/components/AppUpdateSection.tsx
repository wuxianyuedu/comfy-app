"use client";

/**
 * 应用自更新分区（规范 17 §17.2 第③层）。
 *
 * 桌面壳内走 Tauri updater 检测 / 下载 / 重启，浏览器与 dev 环境降级为提示。
 * 全部状态与动作由 controller 的 `appUpdate` 承载，视图只渲染与触发。
 */

import { fmtBytes } from "~/lib/format-bytes";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/page-loading";

import { Card, StatusButton } from "./SettingsPrimitives";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function AppUpdateSection({ c }: { c: ReadySettingsPageController }) {
  return (
    <Card title="应用更新">
      {!c.appUpdate.inShell ? (
        <p className="text-muted-foreground text-sm">
          当前运行在浏览器 / 开发模式，非桌面壳内，无法检测应用更新。
          请使用打包后的桌面版。
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mb-4 text-sm">
            检测 ComfyAPP 应用是否有新版本，需要时可下载并自动安装更新。
            更新源与签名公钥由{" "}
            <code className="text-ink/80">src-tauri/tauri.conf.json</code> 的{" "}
            <code className="text-ink/80">plugins.updater</code> 配置；
            未配置更新源时「检测更新」会提示未配置。
          </p>
          {c.appUpdate.message && (
            <p
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                c.appUpdate.available
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "border-border bg-surface-1 text-ink/80"
              }`}
            >
              {c.appUpdate.message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <StatusButton
              onClick={() => void c.checkAppUpdate()}
              disabled={c.appUpdate.busy !== "idle"}
            >
              {c.appUpdate.busy === "checking" ? (
                <Spinner className="text-primary-foreground size-3.5" />
              ) : (
                "检测更新"
              )}
            </StatusButton>
            {c.appUpdate.available && (
              <StatusButton
                variant="success-solid"
                onClick={() => void c.installAppUpdate()}
                disabled={c.appUpdate.busy !== "idle"}
              >
                {c.appUpdate.busy === "installing" ? (
                  <Spinner className="text-primary-foreground size-3.5" />
                ) : (
                  "下载并更新"
                )}
              </StatusButton>
            )}
            <Button
              variant="outline"
              onClick={() => void c.relaunchApp()}
              disabled={c.appUpdate.busy !== "idle"}
              className="text-muted-foreground hover:text-ink h-auto rounded-lg px-4 py-2 font-semibold"
            >
              重启应用
            </Button>
          </div>
          {c.appUpdate.busy === "installing" && c.appUpdate.progress && (
            <div className="mt-4">
              <div className="border-border bg-surface-1 h-2 w-full overflow-hidden rounded-full border">
                <div
                  className="bg-primary h-full rounded-full transition-[width]"
                  style={{
                    width: c.appUpdate.progress.total
                      ? `${Math.min(
                          100,
                          Math.round(
                            (c.appUpdate.progress.downloaded /
                              c.appUpdate.progress.total) *
                              100,
                          ),
                        )}%`
                      : "40%",
                  }}
                />
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">
                正在下载更新…（
                {c.appUpdate.progress.total
                  ? `${fmtBytes(c.appUpdate.progress.downloaded)} / ${fmtBytes(c.appUpdate.progress.total)}`
                  : fmtBytes(c.appUpdate.progress.downloaded)}
                ）
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
