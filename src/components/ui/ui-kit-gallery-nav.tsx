"use client";

import { UI_KIT_CATEGORIES } from "~/components/ui/ui-kit-gallery-categories";

/**
 * UI 控件总览的左侧大类导航（ISSUE #4125）—— 项多了以后一屏上下滚很难找，
 * 这一列把八个分区一次列全，点一下锚点跳到对应分区。
 *
 * 清单读 ui-kit-gallery-categories（与各分区 id 同一出处，改名不会点空）。
 * 纯 `<a href="#id">` 锚点跳转：不用 JS、不持状态，滚动容器（根节点）自己
 * 处理定位；`scroll-mt-4` 在 GallerySection 上留出落点余量。
 * sticky 只在这一列上 —— 右侧分区照常随页面滚，左侧清单始终在视野里。
 */
export function UiKitCategoryNav() {
  return (
    <nav aria-label="控件分类" className="shrink-0">
      <p className="text-ink-faint text-2xs mb-2 px-2 font-semibold tracking-wider uppercase">
        控件分类
      </p>
      <ul className="flex flex-col gap-0.5">
        {UI_KIT_CATEGORIES.map((category) => (
          <li key={category.id}>
            <a
              className="text-ink-muted hover:bg-subtle hover:text-ink block rounded-md px-2 py-1.5 text-xs transition-colors"
              href={`#${category.id}`}
            >
              {category.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
