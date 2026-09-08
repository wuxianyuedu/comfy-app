"use client";

/**
 * 设置页容器（规范 17 §17.2 第④层）。
 *
 * 全部 tRPC 查询、草稿状态、Ollama 探测与保存动作搬进
 * `hooks/use-settings-page.ts`，两处裸 `fetch` 搬进 `lib/llm/ollama-client.ts`，
 * JSX 搬进 `SettingsPageView.tsx`。
 *
 * 打开即先渲染「设置外壳（header + 分区导航）+ 内容区三态」，让界面框架秒开；
 * 不再用整屏 loading 挡掉导航，等全部配置就绪。就绪后内容区交回
 * `SettingsPageView`（其自身也复用同一外壳）。
 */

import { PageLoading } from "~/components/ui/page-loading";
import { SettingsShell } from "@/components/settings/SettingsShell";

import { SettingsPageView } from "./SettingsPageView";
import { useSettingsPage } from "./hooks/use-settings-page";

export default function SettingsPage() {
  const c = useSettingsPage();

  const frame = { section: c.section, onSelect: c.setSection };

  // 仅在首次加载且无数据时，内容区显示局部 loading（框架与导航已秒开）
  if (c.isInitialLoad) {
    return (
      <SettingsShell {...frame}>
        <PageLoading className="bg-bg min-h-[60vh] pb-6" />
      </SettingsShell>
    );
  }

  if (c.hasError) {
    return (
      <SettingsShell {...frame}>
        <div className="grid min-h-[60vh] place-items-center p-6 text-center">
          <div>
            <p className="text-rose-400">加载设置失败，请刷新重试</p>
            <p className="text-muted-foreground mt-2 text-xs">{c.errorText}</p>
            <button
              onClick={c.retry}
              className="bg-primary mt-4 rounded-lg px-4 py-2 text-sm text-white"
            >
              重试
            </button>
          </div>
        </div>
      </SettingsShell>
    );
  }

  // 此时草稿应已就绪；若仍为空则内容区显示降级 UI（不应触发，但满足 TypeScript）
  if (!c.drafts) {
    return (
      <SettingsShell {...frame}>
        <div className="text-muted-foreground grid min-h-[60vh] place-items-center pb-6">
          配置数据未就绪
        </div>
      </SettingsShell>
    );
  }

  /* `drafts` 已收窄为非空 —— 视图据此免判空。 */
  return <SettingsPageView c={{ ...c, drafts: c.drafts }} />;
}
