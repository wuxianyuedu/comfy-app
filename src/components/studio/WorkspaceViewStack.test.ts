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

describe("WorkspaceViewStack — 重视图非活跃降级（ISSUE #4677）", () => {
  const code = stripComments(fs.readFileSync(STACK_FILE, "utf8"));

  it("重视图名单钉住 queue / history / settings", () => {
    /* 名单是这次逐视图评估的结论（画布的内部交互态另评，刻意不在内）：
     * 名单被顺手增删时这条会红，逼着回到单子里重新过一遍评估。 */
    const decl = /HEAVY_VIEWS = new Set<WorkspaceView>\(\[(?<list>[^\]]*)\]\)/.exec(code);
    expect(decl, "HEAVY_VIEWS 名单不在场").not.toBeNull();
    const names = (decl?.groups?.list ?? "").match(/"[a-z-]+"/g) ?? [];
    expect(names).toEqual(['"queue"', '"history"', '"settings"']);
  });

  it("名单里的屏经 HeavyViewGate 按页签活跃度降级", () => {
    expect(code).toContain("HeavyViewGate");
    expect(code).toMatch(/HEAVY_VIEWS\.has\(tab\.view\)/);
    expect(code).toMatch(/<HeavyViewGate active=\{isActive\}>/);
  });
});
