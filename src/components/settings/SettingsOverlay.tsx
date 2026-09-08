"use client";

/**
 * SettingsOverlay — settings UI opened as an in-workspace full-screen overlay.
 *
 * 与独立路由 /settings 相比，overlay 不卸载 workspace 页面组件树——canvas /
 * 工坊 / 工作流库等视图内的选中项与编辑内容天然保留，关闭设置后原样恢复。
 *
 * 打开即先渲染「设置外壳（header + 分区导航）+ 内容区三态」，让界面框架秒开，
 * 不再用整屏 loading 挡掉导航。就绪后内容区交回 `SettingsPageView`。
 */

import { useSettingsPage } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsPageView } from "~/app/(main)/settings/SettingsPageView";
import { SettingsShell } from "~/components/settings/SettingsShell";
import { PageLoading } from "~/components/ui/page-loading";

export interface SettingsOverlayProps {
  /** 由父组件保证只在需要时挂载本组件（open 恒为 true）。 */
  onClose: () => void;
}

export function SettingsOverlay({ onClose }: SettingsOverlayProps) {
  const c = useSettingsPage();

  const frame = {
    section: c.section,
    onSelect: c.setSection,
    onClose,
    className: "h-full",
  };

  /* ── Loading / error / not-ready 内容区三态（框架与分区导航始终秒开）── */
  if (c.isInitialLoad) {
    return (
      <div className="bg-bg fixed inset-0 z-50">
        <SettingsShell {...frame}>
          <PageLoading className="bg-bg min-h-[60vh] pb-6" />
        </SettingsShell>
      </div>
    );
  }

  if (c.hasError) {
    return (
      <div className="bg-bg fixed inset-0 z-50">
        <SettingsShell {...frame}>
          <div className="grid min-h-[60vh] place-items-center p-6 text-center">
            <div>
              <p className="text-rose-400">加载设置失败，请刷新重试</p>
              <p className="text-muted-foreground mt-2 text-xs">
                {c.errorText}
              </p>
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
        </SettingsShell>
      </div>
    );
  }

  if (!c.drafts) {
    return (
      <div className="bg-bg fixed inset-0 z-50">
        <SettingsShell {...frame}>
          <div className="text-muted-foreground grid min-h-[60vh] place-items-center pb-6">
            配置数据未就绪
          </div>
        </SettingsShell>
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
