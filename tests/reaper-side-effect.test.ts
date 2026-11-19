/**
 * 回归护栏：ComfyUI 孤儿回收（reaper）必须仍在两个宿主的启动路径上被**显式**起，且模块加载零副作用。动机是真回归：
 * `runner.ts` 曾是 `import "./reaper"` 唯一起点，删除时裸副作用 import 没挪走 ⇒ 孤儿回收被**静默关掉**（行为回归）。
 * P3 §5 ADR §14 D3 翻转：自启在模块图不可见且 import 即起 30s 循环；现为两处显式调用，漏调由「有且仅一处启动点」断言接管。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = join(import.meta.dirname, "..");
const REAPER_PATH = join(ROOT, "src", "lib", "comfyui", "reaper.ts");
const ENQUEUE_PATH = join(process.cwd(), "src", "lib", "comfyui", "enqueue.ts");
const INSTRUMENTATION_PATH = join(process.cwd(), "src", "instrumentation.ts");
const HOST_PATH = join(process.cwd(), "scripts", "executor-host.mjs");

const read = (p: string): string => readFileSync(p, "utf8");

/** 提取模块内全部 import 语句原文（单行与跨行的分组具名导入都覆盖）。 */
function collectImports(src: string): Array<string> {
  const out: Array<string> = [];
  for (const m of src.matchAll(/^import\s[^\n]+?;/gm)) {
    out.push(m[0]);
  }
  const noSingle = src.replaceAll(/^import\s[^\n]+?;/gm, "");
  for (const m of noSingle.matchAll(/import\s[\s\S]*?from\s+["'][^"']+["'];/gm)) {
    out.push(m[0].replaceAll(/\s+/g, " ").trim());
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

  /**
   * **起了就得收** —— 用例侧的对称义务（此前只钉「谁起」没钉「谁收」）：`startReaper()` 的 handle 挂在 `globalThis`
   * （HMR 单例），活到 worker 结束、每 `REAPER_MS` 查库；`vi.resetModules()` 换模块换不掉定时器，`not.toHaveBeenCalled()`
   * 可能命中上条用例的实例（`called 1 times`，负载下退化成 30s 超时）。故按**文件**判「调用点与收尾点同在一份文件」。
   */
  it("用例里 startReaper() 与 stopReaper() 成对出现（起了不收 = 跨用例泄漏）", () => {
    /* 数之前先剥**注释与字符串字面量**：不带这一步，说明段落里正当出现的
     * `startReaper()` 会被当成一次调用（实测：第一版把 `reaper.test.ts` 的文件头
     * 与 `db-schema-ready.test.ts` 的收尾说明各数了一次；这一条判据自己的
     * 报错文案里也写着同一个词，于是它把自己数成「起了没收」）。
     * 剥字符串是必须的 —— 本判据的报错文案正是一个字符串字面量。 */
    /* 注释那一层用唯一实现（旧的前两跳与它的默认档同语义），字符串掩位留在调用方 ——
     * helper 没有「连字符串一起去掉」那一档，这是本判据独有的第三跳，不该被收敛掉
     *（ISSUE #2969 分类里「语义不同」那一堆）。 */
    const strip = (src: string): string =>
      stripComments(src)
        .replaceAll(/"(?:[^"\\]|\\.)*"/g, '""')
        .replaceAll(/'(?:[^'\\]|\\.)*'/g, "''")
        .replaceAll(/`(?:[^`\\]|\\.)*`/g, "``");
    /* 两种真调用形态都算：成员调用（`m.startReaper()`）与解构后直呼
     * （`const { stopReaper } = …; stopReaper()`）。注释里的同形文本靠上面
     * `stripComments()` 挡掉 —— **不能**只认成员调用：解构那一形态正当存在，
     * 漏掉它会把「已经收了」的用例报成没收（本判据第一版就是这样误报的）。 */
    const count = (src: string, name: string): number =>
      [...src.matchAll(new RegExp(`(?:\\.\\s*|\\b)${name}\\(\\)`, "g"))].length;

    const files: Array<string> = [];
    const stack = [join(ROOT, "src"), join(ROOT, "tests")];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.test\.tsx?$/.test(entry.name)) {
          continue;
        }
        files.push(full);
      }
    }
    const unbalanced = files.flatMap((full) => {
      const code = strip(read(full));
      const starts = count(code, "startReaper");
      const stops = count(code, "stopReaper");
      return starts > stops ? [`${full}（起 ${starts} / 收 ${stops}）`] : [];
    });
    expect(
      unbalanced,
      "这些用例起了 reaper 却没停：常驻定时器会活到 worker 结束，" +
        "把下一条用例的「不该被调用」断言打红（真因看起来像超时）。加 `stopReaper()` 收尾",
    ).toEqual([]);
  });
});
