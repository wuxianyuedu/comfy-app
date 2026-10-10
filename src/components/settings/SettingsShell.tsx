"use client";

/**
 * 设置页共享外壳（③视图层）—— 标题行 + 分区导航 + 内容滚动容器。
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
 * ## 分区导航是一条分段的横向 chip 行，不是一个 192px 的竖栏
 *
 * 竖栏是「很多层级的设置」长出来的形状：分组的父项常年只有一个子项，其余 8 项
 * 挤在它下面，分组层级没换来任何导航价值，却先吃掉了四分之一屏宽（内容列因此
 * 常年在 1100px 的上限里被挤成一条）。改成按「模型与后端 / 数据 / 应用 / 诊断」
 * 分段的横向 chip 行之后：
 *   · 内容区拿回那 192px，两个字段并排的表单不再被挤成窄条；
 *   · 顶部一屏之内看得见全部分区，不必先向下滚一遍导航；
 *   · 选中态、键盘语义与原来完全一致（仍是 `<Button aria-current>`，
 *     仍由同一份 `ui/button` 渲染）。
 * 横向溢出交给 `.custom-scrollbar` 那一条具名滚动条，**不换行、不压扁 chip**
 *（规范 03 §3.8.1「一排控件不许被压扁」：窄了就横向滚，不把 chip 折成两行）。
 *
 * 导航上方的 `sectionSummary` 是「当前在哪一节、这一节管什么」那一行 —— 它替掉的
 * 是各分区卡片正文开头那段「本分区是什么」的解释性段落（那种段落每节都写一遍，
 * 而它回答的是导航问题，不是配置问题）。文案表在
 * `settings-section-summary.ts`（纯常量 + 纯派生，可单测）。
 */

import { Fragment, type ReactNode } from "react";

import {
  SETTINGS_SECTIONS,
  type Section,
} from "~/app/(main)/settings/hooks/use-settings-page";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import {
  SETTINGS_SECTION_GROUPS,
  sectionSummary,
} from "./settings-section-summary";

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

        <SettingsSectionNav section={section} onSelect={onSelect} />

        {/* 内容区：滚动归它，所以主操作按钮仍在各区卡片自己的末尾（卡片不是
            滚动容器的直接子项，规范 §4.12 的「主操作固定在滚动区外」不适用）。 */}
        <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * 分区导航（横向 chip 行，按 `SETTINGS_SECTIONS` 的段位分组）。
 *
 * 段名不是第二份分区清单 —— 它只给「哪几项排在一起」起名字，项本身与顺序一律
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
    <nav aria-label="设置分区" className="mt-4 mb-5 shrink-0">
      {/* 一条**单行**的 chip 带，段之间用一个弱化的小圆点分隔 —— 分行的理由是
          当初竖栏里那套「父项 + 一堆缩进的子项」，而那套层级在这里并不存在
          （每一节都是平级的配置区）。四行段位只会把导航撑高到 100px 以上，
          与它替掉的竖栏一样吃首屏。 */}
      <div className="custom-scrollbar -mb-1 flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto pb-1">
        {SETTINGS_SECTION_GROUPS.map((group, groupIndex) => {
          const items = SETTINGS_SECTIONS.filter((item) =>
            group.sections.includes(item.id),
          );
          if (items.length === 0) return null;
          return (
            <Fragment key={group.label}>
              {groupIndex > 0 && (
                <span
                  aria-hidden
                  className="bg-border-strong mx-1 h-3.5 w-px shrink-0"
                />
              )}
              {/* 段名不进可访问名：读屏按 `aria-current` 与按钮文案导航就够了，
                  再念一遍「模型 / 后端 / 数据」只会让这一行更长。 */}
              <span
                aria-hidden
                className="text-ink-fainter px-1 text-xs whitespace-nowrap"
              >
                {group.label}
              </span>
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
                      "h-auto shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                        : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Button>
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
