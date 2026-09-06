"use client";

/**
 * SettingsOverlay — settings UI opened as an in-workspace full-screen overlay.
 *
 * 与独立路由 /settings 相比，overlay 不卸载 workspace 页面组件树——canvas /
 * 工坊 / 工作流库等视图内的选中项与编辑内容天然保留，关闭设置后原样恢复。
 */

import { useSettingsPage } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsPageView } from "~/app/(main)/settings/SettingsPageView";
import { PageLoading } from "~/components/ui/page-loading";

export interface SettingsOverlayProps {
  /** 由父组件保证只在需要时挂载本组件（open 恒为 true）。 */
  onClose: () => void;
}

export function SettingsOverlay({ onClose }: SettingsOverlayProps) {
  const c = useSettingsPage();

  /* ── Loading / error / not-ready early returns（与独立路由 page.tsx 同源）── */
  if (c.isInitialLoad) {
    return (
      <div className="bg-bg fixed inset-0 z-50">
        <PageLoading className="bg-bg h-full pb-6" />
      </div>
    );
  }

  if (c.hasError) {
    return (
      <div className="bg-bg fixed inset-0 z-50 grid place-items-center p-6 text-center">
        <div>
          <p className="text-rose-400">加载设置失败，请刷新重试</p>
          <p className="text-muted-foreground mt-2 text-xs">{c.errorText}</p>
          <button
            onClick={c.retry}
            className="bg-primary mt-4 rounded-lg px-4 py-2 text-sm text-white"
          >
            重试
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground mt-3 block w-full text-sm underline"
          >
            返回工作区
          </button>
        </div>
      </div>
    );
  }

  if (!c.drafts) {
    return (
      <div className="bg-bg text-muted-foreground fixed inset-0 z-50 grid place-items-center pb-6">
        配置数据未就绪
      </div>
    );
  }

  return (
    <div className="bg-bg fixed inset-0 z-50">
      <SettingsPageView
        c={{ ...c, drafts: c.drafts }}
        onClose={onClose}
        className="h-full"
      />
    </div>
  );
}
