"use client";

/**
 * 设置页纯展示视图（规范 17 §17.2 第③层）：只做「外壳 + 分区正文 + 提示条」，自身不持业务状态。
 * 外壳同时挂载全部分区在同一根滚动条里（ISSUE #1722），故分区用一份 `Record<Section, ReactNode>`
 * 映射而非条件渲染 —— 漏项在 `tsc` 就红。外壳的 `section` 只剩「导航高亮」用途，不再决定渲染。
 */

import { useMemo } from "react";

import { SettingsShell } from "~/components/settings/SettingsShell";
import { Button } from "~/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
import type { Section, ReadySettingsPageController } from "./hooks/use-settings-page";

import { AppUpdateSection } from "./components/AppUpdateSection";
import { BackupSection } from "./components/BackupSection";
import { AppearanceSection } from "./components/AppearanceSection";
import { ComfyuiSection } from "./components/ComfyuiSection";
import { DatabaseSection } from "./components/DatabaseSection";
import { ExitSection } from "./components/ExitSection";
import { LogCategorySection } from "./components/LogCategorySection";
import { LlmLocalSection } from "./components/LlmLocalSection";
import { LlmRemoteSection } from "./components/LlmRemoteSection";
import { UpdateCheckSection } from "./components/UpdateCheckSection";

export function SettingsPageView({
  c,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
  title,
}: {
  c: ReadySettingsPageController;
  /** 自定义根容器 class（overlay 模式传 h-full 等覆盖高度）。 */
  className?: string;
  /** 屏级可见标题；页签（或顶栏）已在说屏名时不传（ISSUE #1872，见外壳文档）。 */
  title?: string;
}) {
  /* 分区正文：**每个分区一项，全都在**（外壳铺在同一根滚动条里）。分区组件的
   * props 全是 `c`（或 `c` + 弹窗状态），所以这里只是一张「分区 → 组件」的表。 */
  const sections = useMemo(
    () =>
      ({
        appearance: (
          <>
            <AppearanceSection c={c} />
            {/* 本地更新检测（纯前端偏好：不写入后端设置，存 localStorage） */}
            <UpdateCheckSection />
          </>
        ),
        appUpdate: <AppUpdateSection c={c} />,
        llmLocal: <LlmLocalSection c={c} />,
        llmRemote: <LlmRemoteSection c={c} />,
        comfyui: <ComfyuiSection c={c} />,
        database: <DatabaseSection c={c} />,
        backup: <BackupSection c={c} />,
        exit: <ExitSection c={c} />,
        logs: <LogCategorySection />,
      }) satisfies Record<Section, React.ReactNode>,
    [c],
  );

  return (
    <SettingsShell
      className={className}
      onSelect={c.setSection}
      section={c.section}
      {...(title === undefined ? {} : { title })}
      banner={
        <>
          {c.flash && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                c.flash.kind === "ok"
                  ? "border-success/30 bg-success/10 text-success-strong"
                  : "border-destructive/30 bg-destructive/10 text-danger-strong"
              }`}
            >
              {c.flash.text}
            </div>
          )}

          {/* 读取失败但界面可用（有兜底草稿）：非阻塞提示条 + 重试出口。
              整页错误视图只留给「连兜底都没有」的场景——应用服务刚重启时把整个
              设置页换成错误页，对用户没有任何好处（ISSUE #360）。 */}
          {c.serveState && (
            <Alert className="mb-4 flex items-start gap-3 px-4 py-2 text-sm" variant="warning">
              <AlertDescription className="min-w-0 flex-1 text-sm wrap-break-word">
                本次未能读取最新配置，界面显示的是上一次成功读取的内容：
                {c.serveState.errorText}
              </AlertDescription>
              <AlertAction className="static shrink-0">
                <Button
                  className="border-warning/40 hover:bg-warning/15 h-auto shrink-0 rounded px-2 py-0.5 text-xs"
                  onClick={c.retry}
                  size="xs"
                  variant="outline"
                >
                  重新读取
                </Button>
              </AlertAction>
            </Alert>
          )}
        </>
      }
      jumpSection={c.pendingJump}
      onJumpApplied={c.ackJumpSection}
      sections={sections}
    />
  );
}
