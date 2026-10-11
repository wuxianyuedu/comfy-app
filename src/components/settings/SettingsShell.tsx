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
 * ## 一页到底：导航是**目录**，不是分屏开关
 *
 * 此前导航点一下把右侧换成另一份 JSX（一屏一节）。代价是「从头看到尾」做不到 ——
 * 想比较两个分区的取值得来回点，而正文里没有任何标题说明「现在读的是哪一节」
 *（ISSUE #1722）。现在**所有分区都在同一根滚动条里**，导航退回到它本来的角色：
 *   · 点一项 → 平滑滚到那一节（`scrollToSection`）；
 *   · 手动滚动 → 高亮跟着走（`useSectionScrollSpy` 的 `IntersectionObserver`）。
 * 标题行右侧那句摘要同样跟着滚动变（它就是「我现在在哪」的答案）。
 *
 * 滚动容器在**外壳**这一层（`overflow-y-auto`），分区节是它的子项 ——
 * 「从头部滚到尾」因此是一条连续的滚动条，不再是每节各自一小条。
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
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";

import {
  SETTINGS_SECTIONS,
  type Section,
} from "~/app/(main)/settings/hooks/use-settings-page";
import { Button } from "~/components/ui/button";
import { TreeChildren } from "~/components/ui/tree-rows";
import { cn } from "~/lib/utils";

import {
  SETTINGS_SCROLL_ORDER,
  TREE_GROUPS,
  sectionSummary,
} from "./settings-section-summary";
import { useSectionScrollSpy } from "./use-section-scroll-spy";

/**
 * 外壳的两种形态 —— **恰好给一种**（判别联合，`tsc` 挡住「两头都不给」与
 * 「两头都给」）。
 *
 *   · **就绪**：给 `sections`（每个分区的正文），外壳按 `SETTINGS_SCROLL_ORDER`
 *    （= 导航树的展开顺序）铺成一页，导航是目录、滚动时高亮跟着走；
 *   · **三态**：给 `fallback`（整块内容区的替代品），导航仍在、右侧换成这一块。
 */
type SettingsShellProps = {
  /** 当前分区（导航高亮用）。 */
  section: Section;
  /** 分区变化（点击导航或滚动跟随都走它）。 */
  onSelect: (section: Section) => void;
  /** 根容器高度 class（overlay 模式传 h-full 覆盖）。 */
  className?: string;
  /**
   * 页面级提示条（保存结果 / 读取失败降级），落在滚动区**之内、分区之前**。
   *
   * 放滚动区内是刻意的：它是这一次操作的结果，用户滚下去之后不应该还钉在顶上
   * 占位置；而放在分区之前则保证它不会被第一节的标题挡掉。
   */
  banner?: ReactNode;
} & (
  | {
      /**
       * 每个分区的正文（**一份映射，不许缺项**）。
       *
       * 类型是 `Record<Section, ReactNode>` 而不是 `ReactNode`：外壳把**所有**
       * 分区铺在同一根滚动条里，少一个分区就是正文里凭空缺一段 —— 而它在运行时
       * 完全静默（少渲染一个 `<section>`，滚动条只是短了一点）。让类型挡这一手，
       * 比再加一条运行时判据直接。
       */
      sections: Record<Section, ReactNode>;
      fallback?: undefined;
    }
  | {
      /**
       * 「整块内容区」的替代品（加载中 / 加载失败 / 未就绪三态）。
       *
       * 给了它就不再渲染分区列表：那三态下每个分区都没有可渲染的正文，铺 9 份
       * 同样的占位 / 错误文案等于把同一句话重复 9 遍（也会把滚动条撑成 9 倍的
       * 假长度）。分区**导航仍在**（外壳这一层照常渲染），只是右侧换成这一块。
       */
      fallback: ReactNode;
      sections?: undefined;
    }
);

export function SettingsShell({
  section,
  onSelect,
  className = "h-[calc(100vh-var(--toolbar-height,48px))]",
  banner,
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

  return (
    <div className={`bg-bg flex flex-col overflow-hidden ${className}`}>
      {/* 宽度取统一档位（`--container-medium` = 从前这里写的 max-w-275）：
          设置页是「标题 + 全宽内容」的文档型壳，不并入更宽的编辑器容器，
          但同一个数不该有两个家。 */}
      <div className="max-w-medium mx-auto flex min-h-0 w-full flex-1 flex-col px-6 pt-6">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-title u-title-page">设置</h1>
          {/* 分区说明与标题同一行、弱一档：它是导航问题的答案（「我现在在哪」）。
              一页到底之后这句话由**每个分区自己的标题行**承接（它就是滚动到那一节
              时读到的那一行），这里只留一句不走动的页面级说明。 */}
          <p className="text-ink-muted min-w-0 flex-1 text-sm">
            全部设置在一页里，按左侧目录跳转或直接滚动
          </p>
        </header>

        {/* 导航在左、内容在右：树需要的是**纵向**空间（父行 + 缩进子行），
            而横排那条带子只能靠分隔符暗示分组 —— 层级读不出来。 */}
        <div className="flex min-h-0 flex-1 gap-6 pt-4">
          <SettingsSectionNav section={section} onSelect={handleSelect} />

          {/* 内容区：**全部**分区节，唯一一根滚动条。每个节自带 `id` 与
              `scroll-mt-*`（顶线偏移，避免滚过去被标题行盖住顶部）。

              主操作按钮仍在各区卡片自己的末尾（规范 §4.12 管的是「列表容器内
              不要放主操作」，这里是文档式长页、卡片不是滚动容器的直接子项）。 */}
          <div
            ref={scrollRef}
            className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6"
          >
            {fallback !== undefined ? (
              fallback
            ) : (
              <>
                {banner}
                {sectionIds.map((id) => (
                  <section
                    key={id}
                    id={sectionAnchorId(id)}
                    ref={registerSection(id)}
                    aria-label={sectionLabel(id)}
                    /* `scroll-mt-*` 是滚过去的**落点补偿**：`scrollIntoView` 把节顶
                   对到容器上沿，不给上边距就会贴着标题行。 */
                    className="scroll-mt-6"
                  >
                    <SettingsSectionHeading section={id} />
                    {sections?.[id]}
                  </section>
                ))}
              </>
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
  return (
    SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? section
  );
}

/**
 * 分区在正文里的标题。
 *
 * 此前「现在读的是哪一节」只由导航的 `aria-current` 与标题行那句摘要表达 ——
 * 正文里一个标题都没有，于是滚动到中段时没有任何本地线索（ISSUE #1722：
 * 「每一项在右侧展示区也要有对应标题」）。
 *
 * 走 `.u-title-stage`（段级档）：它比卡片标题（`.u-title`）重、比屏级标题
 * （`.u-title-page`，每屏唯一那个 h1）轻，正是「屏级与卡片之间那一层」
 *（规范 03 §3.10）。**刻意不写 `text-lg` 这类硬写字号** —— 标题的数值只住在
 * `@theme` 里，调用点只挑档。
 *
 * 字从 `SETTINGS_SECTIONS` 取（不重抄一遍分区名），于是导航与正文标题**不可能
 * 漂移** —— 改一处两边同时改。
 */
function SettingsSectionHeading({ section }: { section: Section }) {
  return (
    <h2 className="u-title-stage border-border-subtle mb-3 flex items-baseline gap-2 border-b pb-2">
      {sectionLabel(section)}
      <span className="text-ink-muted text-xs font-normal">
        {sectionSummary(section)}
      </span>
    </h2>
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
