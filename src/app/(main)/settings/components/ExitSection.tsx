"use client";

/**
 * 退出与后台服务分区（规范 17 §17.2 第③层）。
 * 桌面壳退出时的整树强杀策略由壳决定；这里只暴露「拉起时」后台服务是否脱离
 * 进程树的偏好。纯展示：读写都经 controller。
 */

import { SettingsCard } from "~/components/ui/settings-card";
import { StatusButton } from "~/components/ui/service-status-row";
import { Checkbox } from "~/components/ui/checkbox";
import { FieldLabel } from "~/components/ui/field";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function ExitSection({ c }: { c: ReadySettingsPageController }) {
  return (
    <SettingsCard title="退出与后台服务">
      {/* 同样只留「答案在别处拿不到的那句」：时机口径。开关的语义由每一条自己
          的说明文字讲（它们才是用户真正在选的东西）。 */}
      <p className="text-muted-foreground mb-4 text-xs">
        这些开关是
        <strong className="text-ink/80">拉起的时刻</strong>
        决定的（退出时壳会对整棵进程树强杀，被强杀的进程没有清理机会），因此改动后
        <strong className="text-ink/80">下一次拉起才生效</strong>。
      </p>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={c.drafts.settings.exitKillComfyui}
            id="exit-kill-comfyui"
            onCheckedChange={(next) => {
              c.patchSettings({
                exitKillComfyui: next === true,
              });
            }}
          />
          <FieldLabel className="text-ink/80 text-sm" htmlFor="exit-kill-comfyui">
            关闭应用时连带关闭 ComfyUI
          </FieldLabel>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          默认不勾选：ComfyUI 脱离进程树保活，退出应用后继续运行，下次 打开直接复用；勾选：ComfyUI
          由本应用拉起并挂在应用进程内，应用
          退出时一并关闭。仅对本应用拉起的实例生效；手动在其他终端/窗口 启动的 ComfyUI
          不受此开关影响。
        </p>
      </div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={c.drafts.settings.exitKillOllama}
            id="exit-kill-ollama"
            onCheckedChange={(next) => {
              c.patchSettings({
                exitKillOllama: next === true,
              });
            }}
          />
          <FieldLabel className="text-ink/80 text-sm" htmlFor="exit-kill-ollama">
            关闭应用时连带关闭 Ollama
          </FieldLabel>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          语义同上。取消勾选后 Ollama 保活，重启应用可继续复用已加载的 模型。仅对本应用拉起的 serve
          进程生效；Ollama 注册为系统服务 或你手动启动的不受此开关影响。
        </p>
      </div>
      <div className="border-border bg-surface-1 mb-4 rounded-lg border px-3 py-2">
        <p className="text-ink/80 mb-1 text-sm font-medium">关于 Drizzle Studio</p>
        <p className="text-muted-foreground text-xs">
          数据库（SQLite）由 better-sqlite3 内嵌进应用进程，没有独立
          进程可「关」——应用退出即随之关闭，无需、也无法单独保活。 此项仅作说明，不提供开关。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusButton
          disabled={c.saving}
          // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
          onClick={() => void c.savePrefs()}
          variant="primary-solid"
        >
          保存偏好
        </StatusButton>
      </div>
    </SettingsCard>
  );
}
