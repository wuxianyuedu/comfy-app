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
 * 「一段路径 A / B / 当前 C」的**唯一实现**（规范 16 §16.2.4.72）：素材库抽屉与资源库页曾各手写一份同一渲染并绕开 `ui/breadcrumb`，丢掉 `ol` / `li` 层级与 `aria-current="page"`。
 * **收**：路径行的排版与语义（`ui/breadcrumb` 整套 slot）、「末段不可点 / 中间段可点」契约、分隔符；**不收**：段从哪来（归 controller）、点中间段做什么（归 `onNavigate`）、末段是否换成当前态药丸（属页头）。
 */

/** 路径的一段：`key` 为 `null` 表示不可导航（末段常为当前项）。 */
export type BreadcrumbSegment = {
  key: string | null;
  label: string;
};

/**
 * 路径行（`A / B / 当前 C`）。`navigable` 为 `false` 时**全部段**都渲染成不可点
 * （搜索结果态：层级已无意义，回退由「清空搜索」那一处承担）。
 */
export function BreadcrumbPath({
  segments,
  onNavigate,
  navigable = true,
  className,
  label = "路径",
}: {
  className?: string;
  label?: string;
  navigable?: boolean;
  onNavigate: (key: string) => void;
  segments: ReadonlyArray<BreadcrumbSegment>;
}) {
  if (segments.length === 0) {
    return null;
  }
  return (
    <Breadcrumb aria-label={label} className={className}>
      <BreadcrumbList className="gap-0 text-xs">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          /* 末段（当前所在处）与「整体不可导航」都渲染成纯展示：前者点它会重入同一层，后者层级已失效。
           * 可导航性收进带类型谓词的局部常量 `navKey`，而非在 onClick 里用 `seg.key!`：断言会把
           * 「判过有值」与「取用时假定有值」拆到两处，改一处漏一处就是运行时 `undefined`；
           * 收成 `navKey` 后 `typeof` 判据与取值同源（§18 类型安全口径）。 */
          const navKey = navigable && !isLast && typeof seg.key === "string" ? seg.key : null;
          return (
            <React.Fragment key={seg.key ?? `seg-${String(i)}`}>
              {i > 0 && (
                <BreadcrumbSeparator className="text-ink-fainter text-2xs mx-1.5 [&>svg]:size-3">
                  /
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem>
                {navKey === null ? (
                  <BreadcrumbPage
                    className={cn(
                      "text-xs",
                      isLast && navigable ? "text-ink-bright font-medium" : "text-ink-soft",
                    )}
                  >
                    {seg.label}
                  </BreadcrumbPage>
                ) : (
                  <Button
                    className="text-ink-muted hover:text-primary-strong h-auto p-0 text-xs font-normal hover:bg-transparent hover:underline"
                    onClick={() => {
                      onNavigate(navKey);
                    }}
                    variant="ghost"
                  >
                    {seg.label}
                  </Button>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
