"use client";

/**
 * 退出与后台服务分区（规范 17 §17.2 第③层）。
 *
 * 桌面壳退出时的整树强杀策略由壳决定，这里只暴露「拉起时」是否让后台服务
 * 脱离进程树的偏好（ComfyUI / Ollama），以及保存出口。纯展示：读写都经
 * controller 的 `drafts.settings` / `patchSettings` / `savePrefs`。
 */

import { Btn, Card } from "./SettingsPrimitives";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function ExitSection({ c }: { c: ReadySettingsPageController }) {
  return (
    <Card title="退出与后台服务">
      <p className="text-muted-foreground mb-4 text-sm">
        桌面壳退出时会对应用进程树执行整树强制关闭（被强杀的进程没有清理机会），
        因此这些开关是
        「拉起时」决定后台服务是否脱离进程树，不是退出那一刻再选。 改动后
        <strong className="text-ink/80">下一次拉起才生效</strong>。
      </p>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <input
            id="exit-kill-comfyui"
            type="checkbox"
            className="size-4 accent-[var(--primary,#7c5cff)]"
            checked={c.drafts.settings.exitKillComfyui ?? false}
            onChange={(event) =>
              c.patchSettings({
                exitKillComfyui: event.target.checked,
              })
            }
          />
          <label htmlFor="exit-kill-comfyui" className="text-ink/80 text-sm">
            关闭应用时连带关闭 ComfyUI
          </label>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          默认不勾选：ComfyUI 脱离进程树保活，退出应用后继续运行，下次
          打开直接复用；勾选：ComfyUI 由本应用拉起并挂在应用进程内，应用
          退出时一并关闭。仅对本应用拉起的实例生效；手动在其他终端/窗口 启动的
          ComfyUI 不受此开关影响。
        </p>
      </div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <input
            id="exit-kill-ollama"
            type="checkbox"
            className="size-4 accent-[var(--primary,#7c5cff)]"
            checked={c.drafts.settings.exitKillOllama ?? true}
            onChange={(event) =>
              c.patchSettings({
                exitKillOllama: event.target.checked,
              })
            }
          />
          <label htmlFor="exit-kill-ollama" className="text-ink/80 text-sm">
            关闭应用时连带关闭 Ollama
          </label>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          语义同上。取消勾选后 Ollama 保活，重启应用可继续复用已加载的
          模型。仅对本应用拉起的 serve 进程生效；Ollama 注册为系统服务
          或你手动启动的不受此开关影响。
        </p>
      </div>
      <div className="border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2">
        <p className="text-ink/80 mb-1 text-sm font-medium">
          关于 Drizzle Studio
        </p>
        <p className="text-muted-foreground text-xs">
          数据库（SQLite）由 better-sqlite3 内嵌进应用进程，没有独立
          进程可「关」——应用退出即随之关闭，无需、也无法单独保活。
          此项仅作说明，不提供开关。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Btn onClick={() => void c.savePrefs()} disabled={c.saving}>
          保存偏好
        </Btn>
      </div>
    </Card>
  );
}
