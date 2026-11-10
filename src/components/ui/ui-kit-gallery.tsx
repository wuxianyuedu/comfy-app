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

/**
 * UI 控件总览（`/ui-kit`，ISSUE #3525）—— 把项目里全部可视化基元摆到同一屏。
 *
 * 目的只有一个：让「控件颜色 / 背景色错档」在明暗两态下都一眼可见。
 * 主题开关走 `next-themes`（与设置页同一出口），切的是**应用全局**主题 ——
 * 这正是本页要的：同一屏在真实主题链路下翻面，而不是复制品。
 * 逐 prop 的形态矩阵不在这页（Storybook 的量程）；基元的取值事实以
 * `globals.css` 为准，`docs/DESIGN.md` 是从它反推的评审基准。
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

export function UIKitGallery() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8">
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
