"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { PageHeader } from "~/components/ui/page-header";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ActionsSection } from "~/components/ui/ui-kit-gallery-actions";
import { DataSection } from "~/components/ui/ui-kit-gallery-data";
import { FormsSection } from "~/components/ui/ui-kit-gallery-forms";
import { NavigationSection } from "~/components/ui/ui-kit-gallery-navigation";
import { OverlaysSection } from "~/components/ui/ui-kit-gallery-overlays";
import { StatusSection } from "~/components/ui/ui-kit-gallery-status";
import { TokenWall } from "~/components/ui/ui-kit-gallery-tokens";
import { cn } from "~/lib/utils";

/**
 * UI 控件总览（`/ui-kit`，ISSUE #3525）—— 把项目里全部可视化基元摆到同一屏。
 *
 * 目的只有一个：让「控件颜色 / 背景色错档」在明暗两态下都一眼可见。
 * 主题开关走 `next-themes`（与设置页同一出口），切的是**应用全局**主题 ——
 * 这正是本页要的：同一屏在真实主题链路下翻面，而不是复制品。
 * 逐 prop 的形态矩阵不在这页（Storybook 的量程）；基元的取值事实以
 * `globals.css` 为准，`docs/DESIGN.md` 是从它反推的评审基准。
 *
 * 滚动容器（ISSUE #3798）：这一屏挂在两个地方 —— 工作区视图页签（外层内容列是
 * `overflow-hidden`）与独立路由 `/ui-kit`。两处都不会「由父级替它滚」，所以根节点
 * 必须是自己那根滚动条；否则基元一多就被外层裁掉，滚轮无处可滚、下半屏永远看不到。
 * 高度与 `SettingsView` 同形：页签里由外层给 `h-full`（`fillHeight`），独立路由走
 * 外壳自己的视口档 —— 一份实现，两个挂载点各只负责「多高」。
 */

/** 主题开关：明暗两态一键翻面。 */
function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const current = theme === "light" ? "light" : "dark";
  return (
    <ToggleGroup
      aria-label="预览主题"
      multiple={false}
      onValueChange={(values) => {
        /* base-ui 的值是数组；单选组取第一项，点已选项发空数组即不动作。 */
        const next = values[0];
        if (next === "light" || next === "dark") {
          setTheme(next);
        }
      }}
      spacing={2}
      value={[current]}
      variant="outline"
    >
      <ToggleGroupItem aria-label="浅色" value="light">
        <Sun aria-hidden className="size-4" />
        浅色
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="深色" value="dark">
        <Moon aria-hidden className="size-4" />
        深色
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function UIKitGallery({ fillHeight }: { fillHeight?: boolean }) {
  return (
    <div
      className={cn(
        "custom-scrollbar mx-auto flex w-full max-w-6xl flex-col gap-10 overflow-y-auto px-6 py-8",
        fillHeight === true ? "h-full" : "h-[calc(100vh-var(--toolbar-height,48px))]",
      )}
      data-slot="ui-kit-scroll"
    >
      <PageHeader
        actions={<ThemeToggle />}
        description="全部基元在一屏上对照明暗两态，控件颜色 / 背景色错档在这里一眼可见。"
        help="右上角开关切的是应用全局主题（与设置页同源、会记住选择）。逐 prop 的形态矩阵看 Storybook（pnpm storybook）。"
        title="UI 控件总览"
      />
      <TokenWall />
      <ActionsSection />
      <FormsSection />
      <OverlaysSection />
      <NavigationSection />
      <StatusSection />
      <DataSection />
    </div>
  );
}
