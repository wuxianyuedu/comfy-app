"use client";

/**
 * 设置页的纯展示视图（规范 17 §17.2 第③层）。
 *
 * 只做「外壳 + 分区路由 + 提示条」：按 `controller.section` 渲染对应分区组件，
 * 自身不再持任何业务状态。分区视图在 `components/`，弹窗交互状态在
 * `hooks/use-remote-model-dialogs.ts`（第②层），提交校验与网络都在 controller。
 */

import { SettingsShell } from "@/components/settings/SettingsShell";

import { AppUpdateSection } from "./components/AppUpdateSection";
import { AppearanceSection } from "./components/AppearanceSection";
import { ComfyuiSection } from "./components/ComfyuiSection";
import { DatabaseSection } from "./components/DatabaseSection";
import { ExitSection } from "./components/ExitSection";
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
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          }`}
        >
          {c.flash.text}
        </div>
      )}

      {/* 读取失败但界面可用（有兜底草稿）：非阻塞提示条 + 重试出口。
          整页错误视图只留给「连兜底都没有」的场景——应用服务刚重启时把整个
          设置页换成错误页，对用户没有任何好处（ISSUE #360）。 */}
      {c.serveState && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          <span className="min-w-0 flex-1 break-words">
            本次未能读取最新配置，界面显示的是上一次成功读取的内容：
            {c.serveState.errorText}
          </span>
          <button
            type="button"
            onClick={c.retry}
            className="shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-xs transition-colors hover:bg-amber-500/15"
          >
            重新读取
          </button>
        </div>
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
    </SettingsShell>
  );
}
