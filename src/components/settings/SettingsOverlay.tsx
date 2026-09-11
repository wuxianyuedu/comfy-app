"use client";

/**
 * SettingsOverlay — settings UI opened as an in-workspace full-screen overlay.
 *
 * 与独立路由 /settings 相比，overlay 不卸载 workspace 页面组件树——canvas /
 * 工坊 / 工作流库等视图内的选中项与编辑内容天然保留，关闭设置后原样恢复。
 *
 * 打开即先渲染「设置外壳（header + 分区导航）+ 内容区三态」，让界面框架秒开，
 * 不再用整屏 loading 挡掉导航。就绪后内容区交回 `SettingsPageView`。
 *
 * 铺满范围：用 `FullScreenLayer` 让出窗口标题行（页签栏 + 窗口按钮），
 * 只铺满标题行下方的内容区——否则页签会被整条盖住，用户打不开别的页签
 * （ISSUE #310 回归）。
 */

import { useSettingsPage } from "~/app/(main)/settings/hooks/use-settings-page";
import { SettingsPageView } from "~/app/(main)/settings/SettingsPageView";
import { SettingsLoadError } from "~/app/(main)/settings/page";
import { SettingsShell } from "~/components/settings/SettingsShell";
import { PageLoading } from "~/components/ui/page-loading";
import { FullScreenLayer } from "~/components/studio/fullscreen/FullScreenLayer";

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
      <FullScreenLayer zClass="z-50" className="bg-bg">
        <SettingsShell {...frame}>
          <PageLoading className="bg-bg min-h-[60vh] pb-6" />
        </SettingsShell>
      </FullScreenLayer>
    );
  }

  if (c.hasError) {
    return (
      <FullScreenLayer zClass="z-50" className="bg-bg">
        <SettingsShell {...frame}>
          {/* 与独立路由 /settings 共用同一套降级视图：错误可展开/复制、
              引导打开日志面板（面板与文件日志都收了这条失败）。 */}
          <div className="relative">
            <SettingsLoadError errorText={c.errorText} onRetry={c.retry} />
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground absolute bottom-6 left-1/2 -translate-x-1/2 text-sm underline"
            >
              返回工作区
            </button>
          </div>
        </SettingsShell>
      </FullScreenLayer>
    );
  }

  if (!c.drafts) {
    return (
      <FullScreenLayer zClass="z-50" className="bg-bg">
        <SettingsShell {...frame}>
          {/* 同独立路由：兜底也要有「重试 + 日志面板」出口，不给死胡同文案 */}
          <div className="relative">
            <SettingsLoadError
              errorText="配置数据未就绪（查询已结束但未返回可用配置）"
              onRetry={c.retry}
            />
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground absolute bottom-6 left-1/2 -translate-x-1/2 text-sm underline"
            >
              返回工作区
            </button>
          </div>
        </SettingsShell>
      </FullScreenLayer>
    );
  }

  return (
    <FullScreenLayer zClass="z-50" className="bg-bg">
      <SettingsPageView
        c={{ ...c, drafts: c.drafts }}
        onClose={onClose}
        className="h-full"
      />
    </FullScreenLayer>
  );
}
