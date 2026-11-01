// 工坊六段的**分块失败自愈必须穷尽**（按源码读，不做渲染）。
//
// 为什么这条要机械化：六段是互斥懒加载（每段单独切 bundle），而懒加载的
// `import()` 在 dev server 重建后可能指向被换掉的旧分块 —— 剩下的 Promise 只能
// reject。工坊外面只有路由级边界，一段失败就把另外五段、连同标题与阶段轨道一起
// 打成「页面出错了」（现场：ScriptGenerator 的 async loader 抛
// `Failed to load chunk …`）。判定与刷新出口只有一处实现
// （`~/lib/shell/lazy-chunk-recovery`），这里的判据钉的是**每段都接上了**：
// 漏一段，那一段撞上时仍是整屏崩，而正常构建下完全看不出来。
//
// 不用渲染判据的理由与 `workshop-heading-structure.test.ts` 同一条：要 mock 掉
// 整条 pipeline controller 与四个网络客户端，测的却是一个源码结构事实。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

describe("工坊各段懒加载的分块失败出口", () => {
  const code = stripComments(readSource("WorkshopStageBody.tsx"));

  it("裸 `React.Suspense` 只剩外壳 `StageBoundary` 里那一处", () => {
    /* 外壳自己必须能写一次；除此之外任何一处都是绕过 —— 那一段撞上分块失败
     * 时错误会冒到路由级边界，整屏一起崩。 */
    const opens = code.match(/<React\.Suspense\b/g) ?? [];
    expect(opens).toHaveLength(1);
  });

  it("每个懒加载组件都被 `StageBoundary` 包着（段数与外壳用点同阶）", () => {
    const lazyComponents = code.match(/<Lazy[A-Z]\w*/g) ?? [];
    const boundaries = code.match(/<StageBoundary\b/g) ?? [];
    /* 六段 + 全屏剧本编辑器 = 7 处用点；外壳定义里那一处 `<StageBoundary` 不是
     * JSX 用点（定义写的是 `function StageBoundary(`），所以计数就是对得上的。 */
    expect(lazyComponents.length).toBeGreaterThanOrEqual(7);
    expect(boundaries).toHaveLength(lazyComponents.length);
  });

  it("接线用自愈那一份实现，不另写一套判据", () => {
    const boundary = stripComments(readSource("../ui/use-lazy-chunk-fallback.tsx"));
    expect(boundary).toContain("~/lib/shell/lazy-chunk-recovery");
    expect(boundary).toContain("isChunkLoadFailure");
    expect(code).toContain("~/components/ui/use-lazy-chunk-fallback");
    expect(code).toContain("ErrorBoundary");
  });
});
