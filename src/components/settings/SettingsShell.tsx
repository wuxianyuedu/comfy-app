"use client";

/**
 * 设置页共享外壳（③视图层）——header 返回栏 + 左侧分区导航 + 右侧内容滚动容器。
 *
 * 「就绪视图」`SettingsPageView` 与「加载 / 错误占位壳」都复用它：设置页打开时
 * 外壳（含分区导航）随首帧立即渲染，用户马上看到界面框架，而不是整屏 spinner
 * 等全部配置就绪；内容区按加载 / 错误 / 就绪三态各自展示。
 */

import type { ReactNode } from "react";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  SETTINGS_SECTIONS,
  type Section,
} from "~/app/(main)/settings/hooks/use-settings-page";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

export function SettingsShell({
  section,
  onSelect,
  onClose,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
  children,
}: {
  /** 当前激活分区（导航高亮用）。 */
  section: Section;
  /** 切换到指定分区。 */
  onSelect: (section: Section) => void;
  /** overlay 模式下由调用方传入关闭回调；独立路由下缺省用 router.back()。 */
  onClose?: () => void;
  /** 根容器高度 class（overlay 模式传 h-full 覆盖）。 */
  className?: string;
  /** 右侧内容区（由调用方自持滚动容器 / 三态占位）。 */
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <div className={`bg-bg flex flex-col overflow-hidden ${className}`}>
      {/* Header bar */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-4">
        <Hint label="返回">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onClose ?? (() => router.back())}
            className="text-muted-foreground hover:text-ink"
            aria-label="返回"
          >
            <ArrowLeft data-icon="inline-start" size={18} />
          </Button>
        </Hint>
        <h1 className="u-title-page">设置</h1>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-275 flex-1 gap-6 px-6 pt-6">
        {/* Left sidebar */}
        <nav className="w-48 shrink-0 flex-col gap-1">
          {SETTINGS_SECTIONS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              aria-current={section === item.id ? "true" : undefined}
              onClick={() => onSelect(item.id)}
              className={`h-auto w-full rounded-lg px-3 py-2 text-center text-sm font-medium ${
                section === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-ink"
              }`}
            >
              {item.label}
            </Button>
          ))}
        </nav>

        {/* Content area */}
        <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}
