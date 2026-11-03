"use client";

/** `JsonViewer` 的按需入口（规范 §12.19 / 02 §2.9）。
 * `react18-json-view` 是「展开一行日志看原始 JSON」这一个动作的全部代价，而 `~/components/ui/json-viewer` 此前被静态 import 进日志面板链（workspace/page → studio/index → logs/LogPanel → LogRow → ui/json-viewer）；日志面板常驻在根布局（`layout.tsx` 的 `<LogPanel />`），没人展开任何一行时也照样下载一遍 JSON 树渲染器 —— 本组件把那条边变成 `import()`，只有真的展开某一行才拉进来，之前用 fallback 顶着。
 * 包装层不写在 `json-viewer.tsx` 里：那样是自引用（`lazy(() => import("./json-viewer"))` 写在自身内），且该文件顶层有 `import JsonView from "react18-json-view"` —— 只要有人碰它一次，重依赖就回来了；拆成两份后「谁静态 import 谁」在文件层面可见：判据沿静态边找 `react18-json-view` 的落点，找到 `json-viewer.tsx` 即红，而本文件里那一句是 `import()`、不是边。
 * 判据 `scripts/check-barrel-heavy-deps.cjs`；消费方请 import 本文件的 `LazyJsonViewer`，不要再直接 import `JsonViewer`。 */
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
    <React.Suspense fallback={<div className="text-muted-foreground p-3 text-xs">展开中…</div>}>
      <Inner {...props} />
    </React.Suspense>
  );
}
