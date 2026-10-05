/**
 * 构建期「干净检出」回归护栏（ISSUE #489）
 * ===========================================================================
 *
 * 背景：`next build` 的 collect-page-data / prerender 阶段会为每条路由起
 * worker 加载模块图，**模块级副作用也在此时执行**。最典型的是 ComfyUI 孤儿
 * 任务回收（`src/lib/comfyui/reaper.ts`，由 `enqueue.ts` 裸副作用导入挂在
 * 启动路径）：它在加载时立刻读 `task` 表，而干净检出（CI / 新克隆）只跑了
 * `pnpm install`、没有 `pnpm db:push`，于是 build 期抛 `no such table: task`
 * 把构建打死，且报错行号落在与该库无关的路由文件上。
 *
 * 本用例不去跑真实 build（分钟级、且要在无库状态下），而是把两条**结构性
 * 契约**钉死——它们正是上面那条故障成立的条件：
 *
 *   1. 启动路径上的模块级副作用必须先做就绪判断，不能直接读库；
 *      判据模块本身在「表不存在 / 库不存在」时必须返回 false 而不是抛。
 *   2. 会被 `next-code-frame` 渲染到的构建期模块保持纯 ASCII —— Next 按字节
 *      切串，高亮端点落在多字节字符内部时 Rust 侧 panic，整个 build 被
 *      `Error: Panic in async function` 带走（见规范 §5 对应条目）。
 *
 * 反向验证：把 `reaper.ts` 的 sweepOnce 守卫去掉、或给
 * `db-schema-ready.ts` 加回中文注释，对应用例即失败。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 构建期模块图上、会被 next-code-frame 渲染到的模块：必须纯 ASCII。 */
const ASCII_ONLY_MODULES = ["src/lib/db-schema-ready.ts"];

describe("模块级副作用不得在表未就绪时读库", () => {
  it("reaper 的轮询入口先过 isSchemaReady 守卫", () => {
    const src = read("src/lib/comfyui/reaper.ts");
    // 守卫必须收在单一入口里，而不是散落在各 sweeper 内部
    expect(src).toMatch(/function sweepOnce[\s\S]{0,200}?isSchemaReady\(\)/);
    // 首次调用与定时器都必须经该入口
    expect(src).toMatch(
      /sweepOnce\(\);[\s\S]{0,200}?setInterval\(sweepOnce, REAPER_MS\)/,
    );
    // `void reapStale*Tasks()` 的调用点只允许出现在 sweepOnce 函数体内
    // （裸调会绕过守卫，正是本用例要拦的形态）
    const sweepBody = src.slice(
      src.indexOf("function sweepOnce"),
      src.indexOf("function startReaper"),
    );
    const allCalls =
      src.match(/void reapStale(Queued|Running)Tasks\(\);/g) ?? [];
    const guardedCalls =
      sweepBody.match(/void reapStale(Queued|Running)Tasks\(\);/g) ?? [];
    expect(guardedCalls.length).toBeGreaterThan(0);
    expect(
      guardedCalls.length,
      "sweepOnce 之外存在裸 sweeper 调用，会绕过表就绪守卫",
    ).toBe(allCalls.length);
  });

  it("就绪判据模块导出三态探测与缓存入口", () => {
    const src = read("src/lib/db-schema-ready.ts");
    for (const name of [
      "export function probeSchemaSync",
      "export function isSchemaReady",
      "export function resetSchemaReadinessCache",
    ]) {
      expect(src, `缺少导出：${name}`).toContain(name);
    }
    // 只读打开：库文件不存在时必须报错，而不是悄悄建一个空库
    expect(src).toContain("readOnly: true");
  });

  it("守卫不得吞掉「表在但查询失败」这类真故障", () => {
    const src = read("src/lib/comfyui/reaper.ts");
    // sweeper 各自的 catch 仍在，负责把真故障暴露出来
    expect(src).toContain("reapStaleQueuedTasks 失败");
    expect(src).toContain("reapStaleRunningTasks 失败");
  });
});

describe("构建期模块保持纯 ASCII（next-code-frame panic 规避）", () => {
  it.for(ASCII_ONLY_MODULES)("%s 无非 ASCII 字符", (rel) => {
    const offenders = [...read(rel)]
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => ch.codePointAt(0)! > 0x7f);
    expect(
      offenders.map(({ ch }) => ch),
      `${rel} 含非 ASCII 字符（首个在字符偏移 ${offenders[0]?.idx}）：这些字符会让 ` +
        `next-code-frame 在渲染错误现场时按字节切串切到字符中间，触发 Rust panic ` +
        `(end byte index N is not a char boundary) 并带走整个 next build。`,
    ).toEqual([]);
  });
});
