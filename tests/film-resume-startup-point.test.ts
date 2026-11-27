/**
 * 成片监看恢复扫描的启动点与「一处、只一处」的源形态判据（P3 §5 ADR 5-A）。失败全静默：没人起扫描 → 重启后
 * 停在 `GENERATING` 无日志；起两处 → 同一片被 `composeFilm` 合成两次；在飞表换成模块级 `Set` → 热重启后旧循环还在飞。
 * 没有运行期入口，故钉源码形态；判决本身见 `src/server/film/orchestrator.test.ts` 的 `resumeStalledFilms` 组。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeControlFlow } from "./helpers/source-shape";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 去注释之后还要把控制流花括号归一化：这些断言钉的是「这条判据在不在」，
 * 而 oxlint `curly` 给单语句体补 `{}` 会让 `inFlight.has(id)) return` 变成多行。 */
const code = (rel: string): string =>
  normalizeControlFlow(stripComments(readFileSync(path.join(ROOT, rel), "utf8")), rel);

const ORCHESTRATOR = "src/server/film/orchestrator.ts";
/* 监看循环本体在 film-watch.ts（#4595 拆分）：在飞表、预算常量与恢复扫描都在那份里。 */
const FILM_WATCH = "src/server/film/film-watch.ts";

/** 全仓（src + scripts）里出现 `resumeStalledFilms(` **调用**的文件。 */
function sweepCallSites(): Array<string> {
  const files = [
    "src/instrumentation.ts",
    "src/server/api/routers/film.ts",
    "src/server/agent/run-engine.ts",
    "src/lib/comfyui/executor-dispatch.ts",
    "scripts/executor-host.mjs",
    "scripts/dev-launcher.mjs",
    "scripts/standalone-runtime.mjs",
    ORCHESTRATOR,
    FILM_WATCH,
  ];
  /* 只数调用点：声明行（`export async function resumeStalledFilms(`）也带这个名字，
   * 把它算进来会把模块自己报成第二个启动点。 */
  return files.filter((rel) =>
    code(rel)
      .split("\n")
      .some(
        (line) =>
          line.includes("resumeStalledFilms(") && !line.includes("function resumeStalledFilms"),
      ),
  );
}

describe("恢复扫描的启动点：Next 侧一处，且只一处", () => {
  it("src/instrumentation.ts 的 nodejs 分支里恰好一处，排在派发循环之后", () => {
    const src = code("src/instrumentation.ts");
    const starts = src.match(/m\.resumeStalledFilms\(\)/g) ?? [];
    expect(starts, "Next 侧必须有且仅有一处 resumeStalledFilms").toHaveLength(1);
    // 顺序也有意义：先转录 stdout → 起回收器 → 起领取循环 → 最后接回影片监看
    // （监看读的是任务行的终态，排在领取循环之后才谈得上「接得上」）。
    expect(src.indexOf("installStreamCapture")).toBeLessThan(src.indexOf("startReaper"));
    expect(src.indexOf("startReaper")).toBeLessThan(src.indexOf("startDispatchLoop"));
    expect(src.indexOf("startDispatchLoop")).toBeLessThan(src.indexOf("resumeStalledFilms"));
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
    const src = code(FILM_WATCH);
    /* 模块级 `const inFlight = new Map()` 是错的：dev 热重启后旧模块那条循环还在飞，
     * 新模块的自己是一份新 Map，看不见它 ⇒ 同一部影片两条循环。而 `??=` 只认键名，
     * 字段形状变了不升版本号 = 读到旧单例里没有这个字段（同 runner-state 的坑）。 */
    expect(src).toMatch(/var filmWatchInFlight_v1: Map<string, Promise<void>> \| undefined/);
    expect(src).toMatch("globalThis.filmWatchInFlight_v1 ??= new Map<string, Promise<void>>()");
    /* #3867：取消后立刻重启的交接语义——等旧循环退场、重读状态、仍 GENERATING
     * 才起新循环；旧早退形状（`inFlight.has(id)) return`）会让新监看被吞。 */
    expect(src).toMatch("const previous = inFlight.get(id)");
    expect(src).toMatch("inFlightFilms().delete(id)");
  });

  it("监看预算的分钟数只有一处出处（文案与判据不许各写一份）", () => {
    const src = code(FILM_WATCH);
    /* #5142：预算常量收进 lib/film/film-wait.ts，与自主 run 的等待方共用同一份。 */
    const shared = code("src/lib/film/film-wait.ts");
    expect(shared).toMatch("export const FILM_WATCH_TICK_MS = 4000;");
    expect(shared).toMatch("export const FILM_WATCH_BASE_MAX_ITER = 240;");
    expect(shared).toMatch("export const FILM_WATCH_PER_SHOT_ITER = 600;");
    expect(shared).toMatch("export function filmWaitTicksFor");
    expect(src).toMatch("FILM_WATCH_TICK_MS as WATCH_POLL_MS");
    expect(src).toMatch("FILM_WATCH_BASE_MAX_ITER as WATCH_BASE_MAX_ITER");
    expect(src).toMatch("FILM_WATCH_PER_SHOT_ITER as WATCH_PER_SHOT_ITER");
    /* #4595：固定 240 轮总预算改成两档——无响应看门狗（连续 900 轮零进展）+
     * 「底仓 240 + 每镜 600 轮」的绝对上限。这里的分钟数都由常量现算，不写死。 */
    expect(src).toMatch("const WATCH_IDLE_MAX_ITER = 900;");
    expect(src).toMatch(
      /const WATCH_IDLE_MIN = Math\.round\(\(WATCH_POLL_MS \* WATCH_IDLE_MAX_ITER\) \/ 60_?000\);/,
    );
    // 两条给用户看的文案都插值同一个常量；写死「16 分钟」的那版改一个不动另一个。
    expect(src.match(/\$\{WATCH_IDLE_MIN\} 分钟/g)).toHaveLength(2);
    expect(src).not.toMatch("超过 16 分钟");
    // 绝对上限在首轮按镜头数补足；循环用的也是常量，不再是裸 4000 / 240。
    expect(src).toMatch("WATCH_BASE_MAX_ITER + total * WATCH_PER_SHOT_ITER");
    expect(src).toMatch("await sleep(WATCH_POLL_MS)");
    expect(src).toMatch("i < maxIter");
  });
});
