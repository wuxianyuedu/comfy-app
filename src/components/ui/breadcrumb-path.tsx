"use client";

import * as React from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * 「一段路径 A / B / 当前 C」的**唯一实现**（规范 16 §16.2.4.72）。
 *
 * ## 这条账的形状
 *
 * 素材库抽屉（`MaterialLibraryPanel`）与资源库页（`ResourceLibrary`）各自
 * 手写了一遍**同一段**渲染：`breadcrumbSegments.map` + `i > 0 && "/"` +
 * `isLast || searching ? <span> : <Button>`。两处的 class 串逐字相同，
 * 差别只在分隔符的 `mx` 档（`mx-1` / `mx-1.5`）—— 这类差异没有报错、
 * 没有告警，只能靠「同一件事只允许一处实现」从结构上消除。
 *
 * 更关键的是它同时**绕开了已装的 `ui/breadcrumb`**：整套基元（`nav` +
 * `ol` + `li` + `Separator` + `Page`）躺在库里零引用，而两处各写一份
 * `span` / `div` 的等价物 —— 语义（`ol` / `li` 的层级、`aria-current="page"`
 * 的当前项）随之丢掉。
 *
 * ## 收什么、不收什么
 *
 * **收**：路径行的排版与语义（`ui/breadcrumb` 的整套 slot）、
 * 「末段不可点 / 中间段可点」这条交互契约、分隔符。
 * **不收**：段从哪来（归各自的 controller）、点中间段做什么（归 `onNavigate`）、
 * 末段是否要换成一枚「当前态」药丸（那属于页头，见「不迁的一类」）。
 */

/** 路径的一段：`key` 为 `null` 表示不可导航（末段常为当前项）。 */
export interface BreadcrumbSegment {
  label: string;
  key: string | null;
}

/**
 * 路径行（`A / B / 当前 C`）。
 *
 * `navigable` 为 `false` 时**全部段**都渲染成不可点（搜索结果态：此时
 * 层级已无意义，回退由「清空搜索」那一处承担）。
 */
export function BreadcrumbPath({
  segments,
  onNavigate,
  navigable = true,
  className,
  label = "路径",
}: {
  segments: ReadonlyArray<BreadcrumbSegment>;
  onNavigate: (key: string) => void;
  navigable?: boolean;
  className?: string;
  label?: string;
}) {
  if (segments.length === 0) return null;
  return (
    <Breadcrumb aria-label={label} className={className}>
      <BreadcrumbList className="gap-0 text-[12px]">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          /* 末段（当前所在处）与「整体不可导航」都渲染成纯展示：
           * 前者点它会重入同一层，后者层级已失效。
           *
           * 可导航性收进一个**带类型谓词的局部常量**，而不是在 onClick 里用
           * `seg.key!`：断言会把「判过有值」与「取用时假定有值」拆到两处，
           * 改一处漏一处就是运行时 `undefined`。收成 `navKey` 之后
           * `typeof navKey === "string"` 既是渲染分支的判据、也是取值的来源
           * （与 `ui/` 别的基元同款，见 §18 的类型安全口径）。 */
          const navKey =
            navigable && !isLast && typeof seg.key === "string"
              ? seg.key
              : null;
          return (
            <React.Fragment key={seg.key ?? `seg-${String(i)}`}>
              {i > 0 && (
                <BreadcrumbSeparator className="text-ink-fainter text-2xs mx-1.5 [&>svg]:size-3">
                  /
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem>
                {navKey !== null ? (
                  <Button
                    variant="ghost"
                    onClick={() => onNavigate(navKey)}
                    className="text-ink-muted hover:text-primary-strong h-auto p-0 text-[12px] font-normal hover:bg-transparent hover:underline"
                  >
                    {seg.label}
                  </Button>
                ) : (
                  <BreadcrumbPage
                    className={cn(
                      "text-[12px]",
                      isLast && navigable
                        ? "text-ink-bright font-medium"
                        : "text-ink-soft",
                    )}
                  >
                    {seg.label}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
