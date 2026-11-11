"use client";

/**
 * 设置页共享外壳（③视图层）—— （可选）标题行 + 分区导航树 + 内容滚动容器，就绪视图与
 * 三态占位壳复用它。要点：无「返回」按钮（`onClose` 按 §12.16 删掉）；一页到底、导航是
 * 目录（ISSUE #1722）、是竖向的树（§16.2.4.39，ISSUE #1694）；页签已给屏名时不重复标题（ISSUE #1872）。
 */

import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { SETTINGS_SECTIONS, type Section } from "~/app/(main)/settings/hooks/use-settings-page";
import { Button } from "~/components/ui/button";
import { TreeChildren } from "~/components/ui/tree-rows";
import { cn } from "~/lib/utils";

import {
  SETTINGS_SCROLL_ORDER,
  TREE_GROUPS,
  isGroupFirstSection,
  sectionGroupLabel,
  sectionSummary,
} from "./settings-section-summary";
import { useSectionScrollSpy } from "./use-section-scroll-spy";

/**
 * 外壳的两种形态 —— **恰好给一种**（判别联合，`tsc` 挡住「两头都不给/都给」）。
 * **就绪**：给 `sections`，外壳按 `SETTINGS_SCROLL_ORDER`（= 导航树展开顺序）铺成一页；
 * **三态**：给 `fallback`，导航仍在、右侧换成这一块。
 */
type SettingsShellProps = {
  /**
   * 页面级提示条（保存结果 / 读取失败降级），落在滚动区**之内、分区之前**。
   * 放滚动区内是刻意的：它是这次操作的结果，不该钉在顶上占位；放分区之前
   * 保证不被第一节标题挡掉。
   */
  banner?: ReactNode;
  /** 根容器高度 class（overlay 模式传 h-full 覆盖）。 */
  className?: string;
  /**
   * 跳转载荷要求直接停驻的目标分区（尚未落定）。外壳在分区节挂好之后**瞬时**滚到
   * 它，并回调 `onJumpApplied`；三态壳（`fallback`）下没有分区节，滚不过去、
   * 也就**不回调**（载荷留着，等就绪外壳再落）。
   */
  jumpSection?: Section | null;
  /** 跳转目标真的滚过去了（外壳命中了锚点）—— 调用方据此消费一次性载荷。 */
  onJumpApplied?: () => void;
  /** 分区变化（点击导航或滚动跟随都走它）。 */
  onSelect: (section: Section) => void;
  /** 当前分区（导航高亮用）。 */
  section: Section;
  /**
   * 屏级可见标题 —— 走 `.u-title-page`。**页签（或顶栏）已经在说屏名时不传**
   * （ISSUE #1872）：那一次出现是重复的，不传时屏名以 `sr-only` 留在 DOM，
   * 这一行也不再占位（口径与 `ui/page-header` 的 `title` / `srTitle` 同一份）。
   */
  title?: string;
} & (
  | {
      fallback?: undefined;
      /**
       * 每个分区的正文（**一份映射，不许缺项**）。
       * 类型是 `Record<Section, ReactNode>`：外壳把**所有**分区铺在同一根滚动条里，
       * 少一个分区就是正文里凭空缺一段——而它在运行时完全静默，让类型挡这一手。
       */
      sections: Record<Section, ReactNode>;
    }
  | {
      /**
       * 「整块内容区」的替代品（加载中 / 加载失败 / 未就绪三态）。
       * 给了它就不再渲染分区列表：三态下每个分区都没有可渲染的正文，铺 9 份同样的
       * 占位等于把同一句话重复 9 遍。分区**导航仍在**，只是右侧换成这一块。
       */
      fallback: ReactNode;
      sections?: undefined;
    }
);

export function SettingsShell({
  section,
  onSelect,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
  title,
  banner,
  jumpSection,
  onJumpApplied,
  fallback,
  sections,
}: SettingsShellProps) {
  /** 滚动容器：分区节挂在它里面，观察器也以它为 root。 */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /* 分区顺序 = 导航树的展开顺序（`SETTINGS_SCROLL_ORDER`）—— 一页到底之后
     「目录的顺序」与「正文的顺序」必须是同一个，否则按目录往下读会跳节。 */
  const sectionIds = useMemo(() => SETTINGS_SCROLL_ORDER, []);
  const { registerSection, scrollToSection } = useSectionScrollSpy({
    containerRef: scrollRef,
    sectionIds,
    activeId: section,
    onActiveChange: onSelect,
  });

  const handleSelect = useCallback(
    (next: Section) => {
      /* 点导航是「滚过去」，不是「换内容」—— 高亮由 `scrollToSection` 立刻改，
       * 滚动只是把用户带过去（滚完观察器给出的也是同一节，不会打架）。 */
      scrollToSection(next);
      onSelect(next);
    },
    [onSelect, scrollToSection],
  );

  /* 跳转载荷的落点：`layout` 期（分区节刚挂上）就**瞬时**滚过去——普通 effect 跑在
   * 观察器建立之后，初始那批回调会把第一个分区判成当前项、覆写刚设好的高亮；平滑
   * 动画期间观察器会先报当前视图里那几节，高亮会闪一下再跳，故用 `behavior: "auto"`。
   * 只有 `scrollToSection` 真命中锚点（返回 true）才回调消费载荷——三态壳没有分区节，
   * 不能把载荷吃掉。 */
  useLayoutEffect(() => {
    if (!jumpSection) {
      return;
    }
    if (scrollToSection(jumpSection, "auto")) {
      onJumpApplied?.();
    }
  }, [jumpSection, scrollToSection, onJumpApplied]);

  return (
    <div className={`bg-bg flex flex-col overflow-hidden ${className}`}>
      {/* 宽度取统一档位（`--container-medium` = 从前这里写的 max-w-275）：
          设置页是「标题 + 全宽内容」的文档型壳，不并入更宽的编辑器容器，
          但同一个数不该有两个家。 */}
      <div className="max-w-medium mx-auto flex min-h-0 w-full flex-1 flex-col px-6 pt-6">
        {/* 屏名：页签（或顶栏）已经在说时**不出现这一行**（`title` 不传），只把
            名字留在 `sr-only` —— 读屏仍能按标题跳转，视觉上不重复第二次
            （规范 03 §3.10 / 06）。`h1` 始终在位，一屏一个；那一行不占位，
            下方导航与内容因此上移。 */}
        {title === undefined ? (
          <h1 className="sr-only">设置</h1>
        ) : (
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-title u-title-page">{title}</h1>
          </header>
        )}

        {/* 导航在左、内容在右：树需要的是**纵向**空间（父行 + 缩进子行），
            而横排那条带子只能靠分隔符暗示分组 —— 层级读不出来。 */}
        <div className="flex min-h-0 flex-1 gap-8 pt-4">
          <SettingsSectionNav onSelect={handleSelect} section={section} />

          {/* 内容区：**全部**分区节，唯一一根滚动条。每个节自带 `id` 与
              `scroll-mt-*`（顶线偏移，避免滚过去被标题行盖住顶部）。

              主操作按钮仍在各区卡片自己的末尾（规范 §4.12 管的是「列表容器内
              不要放主操作」，这里是文档式长页、卡片不是滚动容器的直接子项）。 */}
          <div
            className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pr-4 pb-6"
            ref={scrollRef}
          >
            {fallback === undefined ? (
              <>
                {banner}
                {sectionIds.map((id) => (
                  <section
                    aria-label={sectionLabel(id)}
                    /* `scroll-mt-*` 是滚过去的**落点补偿**：`scrollIntoView` 把节顶
                   对到容器上沿，不给上边距就会贴着标题行。
                   节与节之间用 `mb-*` 拉开一档：上一节卡片末尾与下一节标题
                   若贴着，读起来像同属一组。 */
                    className="mb-8 scroll-mt-6 last:mb-0"
                    id={sectionAnchorId(id)}
                    key={id}
                    ref={registerSection(id)}
                  >
                    <SettingsSectionHeading section={id} />
                    {/* 一节里可能有多张卡片（「备份与恢复」下的「创建备份 / 恢复备份」）：
                        卡片之间要有间距，否则两张卡贴在一起像一块（ISSUE #3547）。 */}
                    <div className="flex flex-col gap-4">{sections?.[id]}</div>
                  </section>
                ))}
              </>
            ) : (
              fallback
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 分区节的 DOM 锚点 id（`settings-<分区 id>`）。 */
export function sectionAnchorId(section: Section): string {
  return `settings-${section}`;
}

/** 分区的可读名（`SETTINGS_SECTIONS` 是分区名的唯一定义处）。 */
function sectionLabel(section: Section): string {
  return SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section;
}

/**
 * 分区在正文里的标题（ISSUE #1722：正文里要有「现在读的是哪一节」的本地线索）。
 * 走 `.u-title-stage`（段级档）：屏级与卡片之间那一层（规范 03 §3.10），数值只住在
 * `@theme` 里。字从 `SETTINGS_SECTIONS` 取，导航与正文标题不可能漂移。
 *
 * 两处按 ISSUE #3519 改过：
 * · **大类标题**（`模型` / `后端` / …）接进正文 —— 每组只出现一次（在组内第一个
 *   分区上），此前正文只说分区名，长页里读不出「这几节属于一类」。
 * · `font-title` 补上：段级标题此前走**正文字体**，17px/600 的笔画在深色下只到
 *   `#c2c2c8`（实测），比同屏 14px 的行标题（`#ededf2`）还暗 —— 「标题比正文还暗」
 *   的观感就是这么来的（用户现场：「这里界面的字体是白色吗，怎么感觉有些暗」）。
 */
function SettingsSectionHeading({ section }: { section: Section }) {
  return (
    <>
      {isGroupFirstSection(section) ? (
        /* 大类：弱一档的小标签（与左侧导航树里的父行同一档），它是「这一组从哪开始」。 */
        <p className="text-ink-fainter mb-1 text-xs font-medium">{sectionGroupLabel(section)}</p>
      ) : null}
      <h2 className="u-title-stage font-title border-border-subtle mb-3 flex items-baseline gap-2 border-b pb-2">
        {sectionLabel(section)}
        <span className="text-ink-muted text-xs font-normal">{sectionSummary(section)}</span>
      </h2>
    </>
  );
}

/**
 * 分区导航（左侧的树，按 `TREE_GROUPS` 分组）。
 * 分组名不是第二份分区清单——项本身与顺序一律来自 `SETTINGS_SECTIONS`（§12.18）；
 * 漏登记一项由 `SettingsShell.test.tsx` 拦下（按 id 集合双向比对）。
 */
function SettingsSectionNav({
  section,
  onSelect,
}: {
  onSelect: (section: Section) => void;
  section: Section;
}) {
  return (
    <nav aria-label="设置分区" className="custom-scrollbar w-40 shrink-0 overflow-y-auto pr-2 pb-2">
      {TREE_GROUPS.map((group) => {
        const items = SETTINGS_SECTIONS.filter((item) => group.sections.includes(item.id));
        if (items.length === 0) {
          return null;
        }
        return (
          <div className="mb-3 last:mb-0" key={group.label}>
            {/* 分组名是父行：弱一档、不可点 —— 它只回答「这几项属于一类」，
                不是导航目标（点了也不会切到某个分区）。读屏不进可访问名，
                分区自身由子行的 `aria-current` 表达。 */}
            <p aria-hidden className="text-ink-muted px-2 text-sm font-medium">
              {group.label}
            </p>
            {/* 子行集合走 `TreeChildren`：缩进档 + 引导线一处给全（§16.2.4.39）。
                `depth=1` 是「父行是分组头」这一档的标准形态。 */}
            <TreeChildren className="flex flex-col gap-0.5" depth={1}>
              {items.map((item) => {
                const active = section === item.id;
                return (
                  <Button
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "h-auto w-full justify-start rounded-lg px-3 py-1.5 text-sm font-medium",
                      active
                        ? "bg-primary-soft text-primary-strong hover:bg-primary-soft hover:text-primary-strong"
                        : "text-ink-muted hover:text-ink",
                    )}
                    key={item.id}
                    onClick={() => {
                      onSelect(item.id);
                    }}
                    size="sm"
                    variant="ghost"
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
