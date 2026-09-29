/**
 * 成片监看恢复扫描的启动点与「一处、只一处」的源形态判据（P3 §5 ADR 5-A）。
 *
 * 为什么钉源形态而不是行为：这一刀的失败形态全是**静默**的 ——
 *   · 谁都没起扫描 → 重启后影片永远停在 `GENERATING`，界面是一个转不完的圈，
 *     而没有任何一行日志说「没人监看它」；
 *   · 起两处 → 同一部影片两条循环并存，两条都会调 `composeFilm`，
 *     而 `markComposing` 是无条件写 ⇒ 同一部片被 ffmpeg 合成两次；
 *   · 在飞表以另一种形态长回来（模块级 `Set`）→ dev 热重启后旧循环还在飞，
 *     新模块看不见它，第二条照样起来。
 * 这三条都没有可单测的运行期入口（要等真进程重启），所以与
 * `tests/dispatch-startup-points.test.ts`、`tests/reaper-side-effect.test.ts` 同族，
 * 钉在源码形状上。判决本身（捡哪些状态、COMPOSING 为何判掉）在
 * `src/server/film/orchestrator.test.ts` 的 `resumeStalledFilms` 组里。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const code = (rel: string): string =>
  stripComments(readFileSync(path.join(ROOT, rel), "utf-8"));

const ORCHESTRATOR = "src/server/film/orchestrator.ts";

/** 全仓（src + scripts）里出现 `resumeStalledFilms(` **调用**的文件。 */
function sweepCallSites(): string[] {
  const files = [
    "src/instrumentation.ts",
    "src/server/api/routers/film.ts",
    "src/server/agent/run-engine.ts",
    "src/lib/comfyui/executor-dispatch.ts",
    "scripts/executor-host.mjs",
    "scripts/dev-launcher.mjs",
    "scripts/standalone-runtime.mjs",
    ORCHESTRATOR,
  ];
  /* 只数调用点：声明行（`export async function resumeStalledFilms(`）也带这个名字，
   * 把它算进来会把模块自己报成第二个启动点。 */
  return files.filter((rel) =>
    code(rel)
      .split("\n")
      .some(
        (line) =>
          line.includes("resumeStalledFilms(") &&
          !line.includes("function resumeStalledFilms"),
      ),
  );
}

describe("恢复扫描的启动点：Next 侧一处，且只一处", () => {
  it("src/instrumentation.ts 的 nodejs 分支里恰好一处，排在派发循环之后", () => {
    const src = code("src/instrumentation.ts");
    const starts = src.match(/m\.resumeStalledFilms\(\)/g) ?? [];
    expect(starts, "Next 侧必须有且仅有一处 resumeStalledFilms").toHaveLength(
      1,
    );
    // 顺序也有意义：先转录 stdout → 起回收器 → 起领取循环 → 最后接回影片监看
    // （监看读的是任务行的终态，排在领取循环之后才谈得上「接得上」）。
    expect(src.indexOf("installStreamCapture")).toBeLessThan(
      src.indexOf("startReaper"),
    );
    expect(src.indexOf("startReaper")).toBeLessThan(
      src.indexOf("startDispatchLoop"),
    );
    expect(src.indexOf("startDispatchLoop")).toBeLessThan(
      src.indexOf("resumeStalledFilms"),
    );
    // Edge runtime 的分支里不许出现（Node-only / server-only 模块进 Edge 图会构建失败）。
    const edge = src.slice(src.indexOf('process.env.NEXT_RUNTIME === "edge"'));
    expect(edge).not.toMatch("resumeStalledFilms");
  });

  it("执行宿主不另起一条扫描（它没有 HTTP 入口，也不该读 film 域）", () => {
    const host = code("scripts/executor-host.mjs");
    expect(host.includes("resumeStalledFilms(")).toBe(false);
    expect(host.includes("watchFilm(")).toBe(false);
  });

  it("全仓只有 Next 那一处调用扫描", () => {
    expect(sweepCallSites()).toEqual(["src/instrumentation.ts"]);
  });
});

describe("去重与预算的同源性（漂开就静默失效的那两条）", () => {
  it("在飞表挂在**带版本号**的 globalThis 键上", () => {
    const src = code(ORCHESTRATOR);
    /* 模块级 `const inFlight = new Set()` 是错的：dev 热重启后旧模块那条循环还在飞，
     * 新模块的自己是一份新 Set，看不见它 ⇒ 同一部影片两条循环。而 `??=` 只认键名，
     * 字段形状变了不升版本号 = 读到旧单例里没有这个字段（同 runner-state 的坑）。 */
    expect(src).toMatch(/var filmWatchInFlight_v1: Set<string> \| undefined/);
    expect(src).toMatch(
      "globalThis.filmWatchInFlight_v1 ??= new Set<string>()",
    );
    expect(src).toMatch("inFlight.has(id)) return");
    expect(src).toMatch("inFlight.delete(id)");
  });

  it("监看预算的分钟数只有一处出处（文案与判据不许各写一份）", () => {
    const src = code(ORCHESTRATOR);
    expect(src).toMatch("const WATCH_POLL_MS = 4000;");
    expect(src).toMatch("const WATCH_MAX_ITER = 240;");
    expect(src).toMatch(
      "const WATCH_BUDGET_MIN = Math.round((WATCH_POLL_MS * WATCH_MAX_ITER) / 60000);",
    );
    // 两条给用户看的文案都插值同一个常量；写死「16 分钟」的那版改一个不动另一个。
    expect(src.match(/\$\{WATCH_BUDGET_MIN\} 分钟/g)).toHaveLength(2);
    expect(src).not.toMatch("超过 16 分钟");
    // 循环用的也是常量，不再是裸 4000 / 240。
    expect(src).toMatch("await sleep(WATCH_POLL_MS)");
    expect(src).toMatch("i < WATCH_MAX_ITER");
  });
});
