"use client";

/**
 * 设置页的纯展示视图（规范 17 §17.2 第③层）。
 *
 * 只做「外壳 + 分区正文 + 提示条」：把**每个分区**的正文交给外壳，由外壳铺在
 * 同一根滚动条里（ISSUE #1722 —— 一页到底，导航退回到「目录」的角色）。
 * 自身不再持任何业务状态。分区视图在 `components/`，弹窗交互状态在
 * `hooks/use-remote-model-dialogs.ts`（第②层），提交校验与网络都在 controller。
 *
 * 为什么是**一份映射**而不是「按 `c.section` 条件渲染」：外壳现在同时挂载全部
 * 分区（滚动跟随要靠它们都在文档里），少一项就是正文里凭空缺一段。映射的类型是
 * `Record<Section, ReactNode>`，漏项在 `tsc` 就红 —— 这比运行时判据直接。
 *
 * 注意：外壳的 `section` **不再决定渲染什么**，它只剩「导航高亮落在哪一项」这一个
 * 用途 —— 渲染与选中从此是两条方向：点击 / 滚动改选中，全部正文一直都在。
 */

import { useMemo } from "react";

import { SettingsShell } from "~/components/settings/SettingsShell";
import { Button } from "~/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";
import type { Section } from "./hooks/use-settings-page";

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
import { useRemoteModelDialogs } from "./hooks/use-remote-model-dialogs";
import type { ReadySettingsPageController } from "./hooks/use-settings-page";

export function SettingsPageView({
  c,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
}: {
  c: ReadySettingsPageController;
  /** 自定义根容器 class（overlay 模式传 h-full 等覆盖高度）。 */
  className?: string;
}) {
  /* 远程模型的弹窗交互状态集中在第②层 hook：视图只消费字段、只渲染 JSX。 */
  const remoteModelDialogs = useRemoteModelDialogs(c);

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
        llmRemote: <LlmRemoteSection c={c} d={remoteModelDialogs} />,
        comfyui: <ComfyuiSection c={c} />,
        database: <DatabaseSection c={c} />,
        backup: <BackupSection c={c} />,
        exit: <ExitSection c={c} />,
        logs: <LogCategorySection />,
      }) satisfies Record<Section, React.ReactNode>,
    [c, remoteModelDialogs],
  );

  return (
    <SettingsShell
      section={c.section}
      onSelect={c.setSection}
      className={className}
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
            <Alert
              variant="warning"
              className="mb-4 flex items-start gap-3 px-4 py-2 text-sm"
            >
              <AlertDescription className="min-w-0 flex-1 text-sm wrap-break-word">
                本次未能读取最新配置，界面显示的是上一次成功读取的内容：
                {c.serveState.errorText}
              </AlertDescription>
              <AlertAction className="static shrink-0">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={c.retry}
                  className="border-warning/40 hover:bg-warning/15 h-auto shrink-0 rounded px-2 py-0.5 text-xs"
                >
                  重新读取
                </Button>
              </AlertAction>
            </Alert>
          )}
        </>
      }
      sections={sections}
    />
  );
}
