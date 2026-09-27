/**
 * 回归护栏：ComfyUI 孤儿回收（reaper）必须仍在两个宿主的启动路径上被**显式**起，
 * 且模块加载本身零副作用。
 *
 * 这条护栏的动机来自一次真回归：`runner.ts` 曾是 `import "./reaper"` 的唯一触发点，
 * 把它收编删除时没人把裸副作用 import 挪到仍在加载的入口上，于是 QUEUED/RUNNING
 * 的孤儿回收被**静默关掉**——那不是死代码清理，是行为回归。当时的结论是「靠模块自
 * 副作用启动，调用方漏不掉」。
 *
 * P3 §5 ADR §14 D3 把方向翻了过来：自启的问题是「谁起 reaper」在模块图上不可见，
 * 而且 host 只要 `import` 这个模块就顺带起一个常驻 30s 循环（「一次性 Q2」因此名
 * 不副实）。翻转后启动点是两处显式调用，而**原护栏的动机不许丢**：漏调用的风险由
 * 下面两条「有且仅有一处启动点」的断言接管——它比旧的那句更硬，因为旧断言只问
 * 「模块自己有没有起」，现在问的是「两个宿主的启动点还在不在、有没有人偷偷多出
 * 第二处」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REAPER_PATH = join(process.cwd(), "src", "lib", "comfyui", "reaper.ts");
const ENQUEUE_PATH = join(process.cwd(), "src", "lib", "comfyui", "enqueue.ts");
const INSTRUMENTATION_PATH = join(process.cwd(), "src", "instrumentation.ts");
const HOST_PATH = join(process.cwd(), "scripts", "executor-host.mjs");

const read = (p: string): string => readFileSync(p, "utf8");

/** 提取模块内全部 import 语句原文（单行与跨行的分组具名导入都覆盖）。 */
function collectImports(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^import\s[^\n]+?;/gm)) {
    out.push(m[0]);
  }
  const noSingle = src.replace(/^import\s[^\n]+?;/gm, "");
  for (const m of noSingle.matchAll(
    /import\s[\s\S]*?from\s+["'][^"']+["'];/gm,
  )) {
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  return out;
}

describe("ComfyUI reaper 启动路径（ADR §14 D3：宿主显式起、模块零副作用）", () => {
  it("reaper 模块加载零副作用：顶层没有裸 startReaper() 调用", () => {
    const src = read(REAPER_PATH);
    expect(
      src,
      "reaper.ts 顶层仍有裸 startReaper()：模块加载即起常驻循环，host import 它就会多出一个回收器",
    ).not.toMatch(/^\s*startReaper\(\);/m);
    // 启动必须是宿主可调的显式出口，而不是藏在模块作用域里。
    expect(src).toMatch(/export function startReaper\s*\(/);
  });

  it("enqueue.ts 不再以裸副作用形式带上 ./reaper（隐式耦合已摘）", () => {
    const sideEffect = collectImports(read(ENQUEUE_PATH)).find(
      (stmt) => stmt.includes('"./reaper"') && !/import\s+[^"]*\{/.test(stmt),
    );
    expect(
      sideEffect,
      "enqueue.ts 又用裸副作用导入 ./reaper：启动点会重新变得不可见",
    ).toBeUndefined();
  });

  /**
   * 「有且仅有一处」是本护栏的核心：少一处 = 孤儿回收静默失效（当年那次回归的
   * 形态），多一处 = 同一进程里两个常驻 sweep 循环重复判决同一批行。
   */
  it("Next 侧启动点有且仅有一处，且落在 instrumentation 的 nodejs 分支里", () => {
    const src = read(INSTRUMENTATION_PATH);
    expect(src.match(/startReaper\(\)/g)?.length, "Next 侧启动点数量").toBe(1);
    // 必须在 `NEXT_RUNTIME === "nodejs"` 分支内：本文件在 Edge runtime 也会执行，
    // Node-only 模块进了 Edge 图会让构建失败。
    const nodeBranch = src.slice(
      src.indexOf('NEXT_RUNTIME === "nodejs"'),
      src.indexOf('NEXT_RUNTIME === "edge"'),
    );
    expect(nodeBranch).toContain("startReaper()");
    expect(nodeBranch).toContain("./lib/comfyui/reaper");
  });

  it("host 侧启动点有且仅有一处（注入链之后），且不裸调 sweeper 绕过表就绪守卫", () => {
    const src = read(HOST_PATH);
    expect(src.match(/startReaper\(\)/g)?.length, "host 侧启动点数量").toBe(1);
    // 首扫（Q2 对账）走 startReaper 内部的 sweepOnce：那里先过 isSchemaReady。
    // 裸调两条 sweeper 会在「表还没建」时抛错，正是硬规则 16 要挡的形态。
    expect(src).not.toMatch(/await reapStale(?:Queued|Running)Tasks\(\)/);
  });
});
