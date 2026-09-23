"use client";

/**
 * 设置页的纯展示视图（规范 17 §17.2 第③层）。
 *
 * 只做「外壳 + 分区路由 + 提示条」：按 `controller.section` 渲染对应分区组件，
 * 自身不再持任何业务状态。分区视图在 `components/`，弹窗交互状态在
 * `hooks/use-remote-model-dialogs.ts`（第②层），提交校验与网络都在 controller。
 */

import { SettingsShell } from "~/components/settings/SettingsShell";
import { Button } from "~/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "~/components/ui/alert";

import { AppUpdateSection } from "./components/AppUpdateSection";
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
  onClose,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
}: {
  c: ReadySettingsPageController;
  /** overlay 模式下由调用方传入关闭回调；独立路由下由外壳 SettingsShell 用 router.back()。 */
  onClose?: () => void;
  /** 自定义根容器 class（overlay 模式传 h-full 等覆盖高度）。 */
  className?: string;
}) {
  /* 远程模型的弹窗交互状态集中在第②层 hook：视图只消费字段、只渲染 JSX。 */
  const remoteModelDialogs = useRemoteModelDialogs(c);

  return (
    <SettingsShell
      section={c.section}
      onSelect={c.setSection}
      onClose={onClose}
      className={className}
    >
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
          <AlertDescription className="min-w-0 flex-1 text-sm break-words">
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

      {/* ═══ Appearance Section ═══ */}
      {c.section === "appearance" && (
        <>
          <AppearanceSection c={c} />
          {/* 本地更新检测（纯前端偏好：不写入后端设置，存 localStorage） */}
          <UpdateCheckSection />
        </>
      )}

      {/* ═══ 应用自更新（desktop 壳；浏览器/dev 环境降级提示）═══ */}
      {c.section === "appUpdate" && <AppUpdateSection c={c} />}

      {/* ═══ 本地模型（Ollama）Section ═══ */}
      {c.section === "llmLocal" && <LlmLocalSection c={c} />}

      {/* ═══ 远程模型（OpenAI 兼容）Section ═══ */}
      {c.section === "llmRemote" && (
        <LlmRemoteSection c={c} d={remoteModelDialogs} />
      )}

      {/* ═══ ComfyUI Section ═══ */}
      {c.section === "comfyui" && <ComfyuiSection c={c} />}

      {/* ═══ 数据库（Drizzle Studio）Section ═══ */}
      {c.section === "database" && <DatabaseSection c={c} />}

      {c.section === "exit" && <ExitSection c={c} />}

      {/* ═══ 日志（分类开关，纯前端偏好：存 localStorage）═══ */}
      {c.section === "logs" && <LogCategorySection />}
    </SettingsShell>
  );
}
