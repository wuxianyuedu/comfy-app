/**
 * 懒加载视图**必须经同一个出口**（ISSUE #1900）。
 *
 * ## 为什么这一条值得机械化
 *
 * `WorkspaceViewStack` 里每一屏都靠 `next/dynamic` 懒加载，而「分块加载失败」
 * 的自愈（判定 + 本会话刷一次）只在 `~/lib/shell/lazy-chunk-recovery` 一处实现。
 * 这条判据钉的是**穷尽性**：只要还有一份 `dynamic(...)` 没走 `lazyView`，那一屏
 * 撞上分块加载失败时就会绕过自愈、整屏崩成「页面出错了」—— 而漏掉的那一份在
 * 正常构建下**完全看不出**（12 屏里 11 屏好、1 屏坏，且只在 dev 重建后偶发）。
 * 正是「漏一个 = 那一个分块仍是裸的」这句，把它做成机器判据。
 *
 * ## 口径
 *
 * - 先过 `stripComments`：文件头大段解释里提到 `next/dynamic` 是在讲历史，
 *   不是一次声明。
 * - 只认这一份文件的**源码形状**（`dynamic(` 的调用点计数），不认运行行为 ——
 *   `next/dynamic` 真正的加载/失败行为在 jsdom 里搭不出来，而这里要防的是
 *   「新加一屏时忘了走出口」，那件事的形状就在源码里。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const FILE = path.join(
  process.cwd(),
  "src/components/studio/WorkspaceViewStack.tsx",
);

describe("WorkspaceViewStack — 懒加载视图都走分块失败自愈出口", () => {
  const code = stripComments(fs.readFileSync(FILE, "utf8"));

  it("只剩一处裸 `dynamic(` —— 出口实现自己那一处", () => {
    /* 出口 `lazyView` 内部调一次 `dynamic`；除此之外任何一次都是绕过。
     * 计数而不是「不许出现」是刻意的：出口本身必须能调它。 */
    const calls = code.match(/\bdynamic\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("每一屏都经 `lazyView(` 声明（数量与视图名单同阶）", () => {
    const calls = code.match(/\blazyView\s*\(/g) ?? [];
    /* 11 份视图声明 + 出口自身那一处 `return dynamic(` 不算 —— `lazyView(`
     * 只出现在声明处，所以这里就是声明份数。下限兜住「有人把声明整段删掉」，
     * 上限由下面那条「声明份数与 renderView 分支同阶」的判据补。 */
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it("文件确实用到了自愈出口（漏了就退回裸 dynamic）", () => {
    expect(code).toContain("reloadOnceForChunkError");
    expect(code).toContain("~/lib/shell/lazy-chunk-recovery");
  });
});

describe("WorkspaceViewStack — 懒加载分块接空闲预热", () => {
  const code = stripComments(fs.readFileSync(FILE, "utf8"));

  it("lazyView 把 loader 登记进预热，视图栈挂载时启动预热", () => {
    /* 为什么要 mechanized：「界面打开」耗时里那段按需编译/现拉的代价原本落在
     * 用户点击之后（现场读数 15~23s）。登记漏一份 = 那一屏的首开仍是点击后才
     * 编译；挂载不启动 = 登记了也没人要。两件事的形状都在源码里，和上面那批
     * 判据同一档，漏了在正常构建下同样看不出。 */
    expect(code).toContain("registerLazyViewLoader(loader)");
    expect(code).toContain("startLazyViewPrefetch()");
  });
});
