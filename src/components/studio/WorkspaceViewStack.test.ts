/**
 * 懒加载视图**必须经同一个出口** `lazyView`（ISSUE #1900）：分块加载失败的自愈只在
 * `~/lib/shell/lazy-chunk-recovery` 一处实现，漏一份 `dynamic(...)` 那屏就绕过自愈整屏崩，
 * 且正常构建下完全看不出（12 屏坏 1 屏、仅 dev 重建后偶发）。先过 `stripComments`，只认源码形状的 `dynamic(` 计数。
 * ISSUE #4765：出口与全部声明收在 `LazyViews.tsx`（项目页容器也从这里取重组件），
 * `WorkspaceViewStack.tsx` 只保留渲染分支与预热启动。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const STACK_FILE = path.join(process.cwd(), "src/components/studio/WorkspaceViewStack.tsx");
const LAZY_FILE = path.join(process.cwd(), "src/components/studio/LazyViews.tsx");

describe("懒加载视图都走分块失败自愈出口（出口在 LazyViews.tsx）", () => {
  const code = stripComments(fs.readFileSync(LAZY_FILE, "utf8"));

  it("只剩一处裸 `dynamic(` —— 出口实现自己那一处", () => {
    /* 出口 `lazyView` 内部调一次 `dynamic`；除此之外任何一次都是绕过。
     * 计数而不是「不许出现」是刻意的：出口本身必须能调它。 */
    const calls = code.match(/\bdynamic\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("每一屏都经 `lazyView(` 声明（数量与视图名单同阶）", () => {
    const calls = code.match(/\blazyView\s*\(/g) ?? [];
    /* 13 份视图声明 + 出口自身那一处 `return dynamic(` 不算 —— `lazyView(`
     * 只出现在声明处，所以这里就是声明份数。下限兜住「有人把声明整段删掉」。 */
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it("文件确实用到了自愈出口（漏了就退回裸 dynamic）", () => {
    expect(code).toContain("reloadOnceForChunkError");
    expect(code).toContain("~/lib/shell/lazy-chunk-recovery");
  });

  it("lazyView 把 loader 登记进预热", () => {
    /* 为什么要 mechanized：「界面打开」耗时里那段按需编译/现拉的代价原本落在
     * 用户点击之后（现场读数 15~23s）。登记漏一份 = 那一屏的首开仍是点击后才
     * 编译；挂载不启动 = 登记了也没人要。两件事的形状都在源码里，和上面那批
     * 判据同一档，漏了在正常构建下同样看不出。 */
    expect(code).toContain("registerLazyViewLoader(loader)");
  });
});

describe("WorkspaceViewStack — 懒加载分块接空闲预热", () => {
  const code = stripComments(fs.readFileSync(STACK_FILE, "utf8"));

  it("视图栈挂载时启动预热", () => {
    expect(code).toContain("startLazyViewPrefetch()");
  });

  it("项目级视图只走「project」一个分支（一项目一页签，ISSUE #4765）", () => {
    /* 画布 / 工坊 / 资源库 / 产出 / 成片由项目页容器按左列表分区拉起；
     * 视图栈里再出现它们的渲染分支，就是有人把页签折叠又拆回去了。 */
    expect(code).toContain("ProjectWorkspace");
    expect(code).not.toMatch(/case "(?<legacy>canvas|workshop|outputs|film|library)"/);
  });
});

describe("WorkspaceViewStack — 重视图非活跃降级（ISSUE #4677 / #5196 收口）", () => {
  const code = stripComments(fs.readFileSync(STACK_FILE, "utf8"));

  it("降级判定走 isHeavyView，栈里不再手写名单（#5196 脱钩根因）", () => {
    /* #5196 的根因就是这份手写白名单与注册表脱钩。改成默认降级的判据后，
     * 栈里既不能有名单常量、也不能再按名单取视图，否则脱钩会重演。 */
    expect(code).not.toMatch(/HEAVY_VIEWS/);
    expect(code).toContain("isHeavyView(tab.view)");
    expect(code).toContain('from "~/components/studio/heavy-view"');
  });

  it("降级的屏经 HeavyViewGate 按页签活跃度降级", () => {
    expect(code).toContain("HeavyViewGate");
    expect(code).toMatch(/isHeavyView\(tab\.view\)\s*\?\s*\(/);
    expect(code).toMatch(/<HeavyViewGate active=\{isActive\}>/);
  });
});

describe("WorkspaceViewStack — 极光背景全栈单实例（ISSUE #5197）", () => {
  const code = stripComments(fs.readFileSync(STACK_FILE, "utf8"));

  it("背景收在 tabs.map 之外的宿主，按 activeView 控制显隐", () => {
    /* 每层全屏 blur 与页签数线性相关是 #5197 的根因：宿主必须在栈外层只有一份，
     * 显隐只改 opacity（visible 由 activeView 决定），不按页签复制背景。 */
    expect(code).toContain("<AuroraBackgroundHost");
    expect(code).toMatch(/<AuroraBackgroundHost visible=\{activeView !== "home"\}>/);
    const mapIndex = code.indexOf("tabs.map(");
    const hostIndex = code.indexOf("<AuroraBackgroundHost");
    expect(hostIndex).toBeLessThan(mapIndex);
  });

  it("页签内不再按视图挂 AuroraBackground，也不再留 isHome 分支", () => {
    const mapBody = code.slice(code.indexOf("tabs.map("));
    expect(mapBody).not.toContain("<AuroraBackground");
    expect(mapBody).not.toContain("isHome");
  });
});
