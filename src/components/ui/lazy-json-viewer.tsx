"use client";

/**
 * `JsonViewer` 的**按需**入口（规范 §12.19 / 02 §2.9）。
 *
 * ## 为什么单独一个文件
 *
 * `react18-json-view` 是「展开一行日志看原始 JSON」这一个动作的全部代价，而
 * `~/components/ui/json-viewer` 此前是**静态** import 进日志面板链的。实测链：
 *
 * ```
 * src/app/workspace/page.tsx
 *   -> components/studio/index.ts
 *   -> logs/LogPanel.tsx -> logs/LogRow.tsx -> ui/json-viewer.tsx
 * ```
 *
 * 日志面板常驻在根布局里（`layout.tsx` 的 `<LogPanel />`），于是**没人展开任何
 * 一行时**它也照样下载一遍 JSON 树渲染器。本组件把那条边变成 `import()`：
 * 只有真的展开某一行（用户动作）时才拉进来，那之前用 `fallback` 顶着。
 *
 * ## 为什么包装层不写在 `json-viewer.tsx` 里
 *
 * 那样就是**自引用**（`lazy(() => import("./json-viewer"))` 写在 `json-viewer.tsx`
 * 内），而且该文件顶层有 `import JsonView from "react18-json-view"` —— 只要有人
 * 碰它一次，重依赖就回来了。拆成两份之后，「谁静态 import 谁」在文件层面就是
 * 可见的：判据沿静态边找 `react18-json-view` 的落点，找到 `json-viewer.tsx` 即红，
 * 而 `lazy-json-viewer.tsx` 里那一句是 `import()`、不是边。
 *
 * 判据：`scripts/check-barrel-heavy-deps.cjs`。消费方请 import 本文件的
 * `LazyJsonViewer`，**不要**再直接 import `JsonViewer`。
 */
import React from "react";

import type { JsonViewerProps } from "~/components/ui/json-viewer";

const Inner = React.lazy(() =>
  import("~/components/ui/json-viewer").then((m) => ({
    default: m.JsonViewer,
  })),
);

/** 与 `JsonViewer` 同参，只是把「拉模块」推迟到真的渲染它时。 */
export function LazyJsonViewer(props: JsonViewerProps) {
  return (
    <React.Suspense
      fallback={
        <div className="text-muted-foreground p-3 text-xs">展开中…</div>
      }
    >
      <Inner {...props} />
    </React.Suspense>
  );
}
