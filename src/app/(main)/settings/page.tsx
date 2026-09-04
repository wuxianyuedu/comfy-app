"use client";

/**
 * 设置页容器（规范 17 §17.2 第④层）。
 *
 * 全部 tRPC 查询、草稿状态、Ollama 探测与保存动作搬进
 * `hooks/use-settings-page.ts`，两处裸 `fetch` 搬进 `lib/llm/ollama-client.ts`，
 * JSX 搬进 `SettingsPageView.tsx`。本文件只剩「取 controller → 传视图 →
 * 处理加载/错误/降级三个早退分支」。
 */

import { SettingsPageView } from "./SettingsPageView";
import { useSettingsPage } from "./hooks/use-settings-page";

export default function SettingsPage() {
  const c = useSettingsPage();

  // 仅在首次加载且无数据时显示 loading；若 query 已结束但数据为空或出错则放行渲染
  if (c.isInitialLoad) {
    return (
      <div className="dark text-muted-foreground grid h-[calc(100vh-var(--toolbar-height,48px))] place-items-center bg-(--color-canvas)">
        加载中…
      </div>
    );
  }

  if (c.hasError) {
    return (
      <div className="dark grid h-[calc(100vh-var(--toolbar-height,48px))] place-items-center bg-(--color-canvas) p-6 text-center">
        <p className="text-rose-400">加载设置失败，请刷新重试</p>
        <p className="text-muted-foreground mt-2 text-xs">{c.errorText}</p>
        <button
          onClick={c.retry}
          className="bg-primary mt-4 rounded-lg px-4 py-2 text-sm text-white"
        >
          重试
        </button>
      </div>
    );
  }

  // 此时草稿应已就绪；若仍为空则显示降级 UI（不应触发，但满足 TypeScript）
  if (!c.drafts) {
    return (
      <div className="dark text-muted-foreground grid h-[calc(100vh-var(--toolbar-height,48px))] place-items-center bg-(--color-canvas)">
        配置数据未就绪
      </div>
    );
  }

  /* `drafts` 在上一步已收窄为非空 —— 视图据此免判空。 */
  return <SettingsPageView c={{ ...c, drafts: c.drafts }} />;
}
