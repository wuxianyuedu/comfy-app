"use client";

/**
 * 设置页共享外壳（③视图层）—— 标题行 + 分区导航树 + 内容滚动容器。
 *
 * 「就绪视图」`SettingsPageView` 与「加载 / 错误占位壳」都复用它：设置页打开时
 * 外壳（含分区导航）随首帧立即渲染，用户马上看到界面框架，而不是整屏 spinner
 * 等全部配置就绪；内容区按加载 / 错误 / 就绪三态各自展示。
 *
 * ## 这里没有「返回」按钮
 *
 * 此前左上是「← 返回」（`router.back()`）—— 而设置在本应用里是**一页页签**，
 * 页签自带关闭按钮、侧栏也永远在；那枚箭头要么是第二条退出路径、要么在独立路由
 * `/settings` 上把用户带回上一页（同一个动作在两个入口下含义不同）。用户看到的
 * 只是一枚占了标题行左端的箭头 —— 标题因此被推离左边缘，而它没有任何独有的作用。
 * 现在标题独占那一行，退出交给页签自己的关闭按钮与侧栏。
 *
 * 因此本模块**不再**需要 `onClose`：两个挂载点此前都不传它（那条分支进不去），
 * 按 §12.16 一并删掉，`SettingsView` / `SettingsPageView` 也不用再透传。
 *
 * ## 分区导航是左侧一棵**竖向的树**，不是一条横排 chip 带
 *
 * 横排那一版把**分组名**与**分区项**排在同一行、同一种字号里，用户读到的是一串
 * 平权的词（`模型 本地模型 远程模型 ｜ 后端 创作后端 ｜ …`）—— 哪个是组、哪个能点
 * 分不出来（ISSUE #1694）。竖排的树把层级还给**缩进 + 引导线**：
 *   · 分组名是父行（弱一档、不可点），分区项是它的子行（可点、`aria-current`）；
 *   · 缩进与引导线由 `~/components/ui/tree-rows` 一次给全（§16.2.4.39，P36 硬闸），
 *     本文件不再手写 `ml-* / border-l-*`；
 *   · 内容区仍是 `--container-medium` 里的那一列，导航固定宽、不长出滚动竞争。
 * 左侧这一列**只放导航**，纵向溢出交给它自己的 `.custom-scrollbar`。
 *
 * 导航上方的 `sectionSummary` 是「当前在哪一节、这一节管什么」那一行 —— 它替掉的
 * 是各分区卡片正文开头那段「本分区是什么」的解释性段落（那种段落每节都写一遍，
 * 而它回答的是导航问题，不是配置问题）。文案表在
 * `settings-section-summary.ts`（纯常量 + 纯派生，可单测）。
 */

import type { ReactNode } from "react";

import {
  SETTINGS_SECTIONS,
  type Section,
} from "~/app/(main)/settings/hooks/use-settings-page";
import { Button } from "~/components/ui/button";
import { TreeChildren } from "~/components/ui/tree-rows";
import { cn } from "~/lib/utils";

import { TREE_GROUPS, sectionSummary } from "./settings-section-summary";

export function SettingsShell({
  section,
  onSelect,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
  children,
}: {
  /** 当前激活分区（导航高亮用）。 */
  section: Section;
  /** 切换到指定分区。 */
  onSelect: (section: Section) => void;
  /** 根容器高度 class（overlay 模式传 h-full 覆盖）。 */
  className?: string;
  /** 右侧内容区（由调用方自持滚动容器 / 三态占位）。 */
  children: ReactNode;
}) {
  return (
    <div className={`bg-bg flex flex-col overflow-hidden ${className}`}>
      {/* 宽度取统一档位（`--container-medium` = 从前这里写的 max-w-275）：
          设置页是「标题 + 全宽内容」的文档型壳，不并入更宽的编辑器容器，
          但同一个数不该有两个家。 */}
      <div className="max-w-medium mx-auto flex min-h-0 w-full flex-1 flex-col px-6 pt-6">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-title u-title-page">设置</h1>
          {/* 分区说明与标题同一行、弱一档：它是导航问题的答案（「我现在在哪、
              这一节管什么」），不该再占一整行高度。 */}
          <p className="text-ink-muted min-w-0 flex-1 text-sm">
            {sectionSummary(section)}
          </p>
        </header>

        {/* 导航在左、内容在右：树需要的是**纵向**空间（父行 + 缩进子行），
            而横排那条带子只能靠分隔符暗示分组 —— 层级读不出来。 */}
        <div className="flex min-h-0 flex-1 gap-6 pt-4">
          <SettingsSectionNav section={section} onSelect={onSelect} />

          {/* 内容区：滚动归它，所以主操作按钮仍在各区卡片自己的末尾（卡片不是
              滚动容器的直接子项，规范 §4.12 的「主操作固定在滚动区外」不适用）。 */}
          <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 分区导航（左侧的树，按 `TREE_GROUPS` 分组）。
 *
 * 分组名不是第二份分区清单 —— 它只给「哪几项挂在一起」起名字，项本身与顺序一律
 * 来自 `SETTINGS_SECTIONS`（§12.18：不许在视图里重抄一遍分区表）。漏登记一项
 * 由 `SettingsShell.test.tsx` 拦下（它按 id 集合双向比对，不按字面量）。
 */
function SettingsSectionNav({
  section,
  onSelect,
}: {
  section: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <nav
      aria-label="设置分区"
      className="custom-scrollbar w-40 shrink-0 overflow-y-auto pb-2"
    >
      {TREE_GROUPS.map((group) => {
        const items = SETTINGS_SECTIONS.filter((item) =>
          group.sections.includes(item.id),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mb-3 last:mb-0">
            {/* 分组名是父行：弱一档、不可点 —— 它只回答「这几项属于一类」，
                不是导航目标（点了也不会切到某个分区）。读屏不进可访问名，
                分区自身由子行的 `aria-current` 表达。 */}
            <p
              aria-hidden
              className="text-ink-fainter px-2 text-xs font-medium"
            >
              {group.label}
            </p>
            {/* 子行集合走 `TreeChildren`：缩进档 + 引导线一处给全（§16.2.4.39）。
                `depth=1` 是「父行是分组头」这一档的标准形态。 */}
            <TreeChildren depth={1} className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = section === item.id;
                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    size="sm"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "h-auto w-full justify-start rounded-lg px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Button>
                );
              })}
            </TreeChildren>
          </div>
        );
      })}
    </nav>
  );
}
