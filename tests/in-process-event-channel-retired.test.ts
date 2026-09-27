/**
 * 进程内事件通道已整体退役（P3 §5 ADR §14 D1 的第一刀）。
 *
 * 为什么要有这一条门禁而不是「删完就算」：执行链过去有两套并行的对外通道——
 * 进程内 `EventEmitter`（`done` / `error` / `progress` / `log` / 合成的 `state`）
 * 与 DB 行。SSE 自 §13-3C 起只读库，emitter 就成了**只剩写入、没有读者**的那
 * 一套：13 处 `emit` 全是空转，而空转的代码比缺代码更坏——它让后来人以为
 * 「取消会发一个事件」「成功有个 done 帧」，于是新宿主（host）也照着这条契约
 * 写，而它在跨进程下根本不成立。首帧那条就是照抄出来的事故面。
 *
 * 所以这里钉三件事：
 *   1. 执行链的任何模块都不再持有 / 投递 EventEmitter；
 *   2. 对外只有 DB 一条通道（首帧改读 `findExecutionProgress` 就是证据）；
 *   3. 客户端解析器里没有「另一种宿主收不到的帧类型」残留。
 * 别处更强的执行者：`tests/reaper-side-effect.test.ts` 管「谁起回收器」，
 * `scripts/check-dead-exports.cjs` 管零消费导出（`subscribe` 正是被它逼着一起删的）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 判据针对的是**代码**：这几处退役的理由就写在注释里（「不再有
 * `s.emitter.emit`」这类句子会自己把自己判红），所以先剥注释再匹配。 */
const src = (rel: string): string =>
  stripComments(readFileSync(path.join(ROOT, rel), "utf-8"));

/** 执行链里「曾经会 emit」的那几个模块。新增执行侧模块时把它加进来。 */
const EXEC_CHAIN_FILES = [
  "src/lib/comfyui/runner-state.ts",
  "src/lib/comfyui/runner-state-shape.ts",
  "src/lib/comfyui/enqueue.ts",
  "src/lib/comfyui/executor.ts",
  "src/lib/comfyui/executor-scheduler.ts",
  "src/lib/comfyui/executor-cli.ts",
  "src/lib/comfyui/executor-finalize.ts",
  "src/lib/comfyui/executor-ws.ts",
  "src/lib/comfyui/reaper.ts",
];

describe("进程内事件通道（EventEmitter）已退役", () => {
  it.each(EXEC_CHAIN_FILES)("%s 里没有 emitter 的构造、持有或投递", (rel) => {
    expect(src(rel)).not.toMatch(/emitter/i);
  });

  it("判据本身有效：注释里的叙述不算，代码里的 emitter 算", () => {
    // 两头都要验：`not.toMatch` 写错成永远为真的形态，上面那组就全绿而无价值。
    expect(
      stripComments(
        "// 这里过去写着 s.emitter.emit(taskId, …)\nconst ok = 1;\n",
      ),
    ).not.toMatch(/emitter/i);
    expect(
      stripComments(
        'const s = state();\ns.emitter.emit(taskId, { type: "done" });\n',
      ),
    ).toMatch(/emitter/i);
  });

  it("RunnerState 的初值工厂不再收 EventEmitter，事件形状 TaskEvent 也不存在了", () => {
    const shape = src("src/lib/comfyui/runner-state-shape.ts");
    expect(shape).not.toMatch(/export type TaskEvent/);
    expect(shape).not.toMatch(/from "events"/);
    expect(shape).toMatch(/export function createEmptyState\(\)/);
  });

  it("enqueue 不再导出 subscribe（零消费导出的判据由 check-dead-exports 兜）", () => {
    expect(src("src/lib/comfyui/enqueue.ts")).not.toMatch(
      /export function subscribe/,
    );
  });
});

describe("首帧这一跳改读 DB（进程内订阅的最后一个消费者）", () => {
  const firstframe = src("src/lib/comfyui/firstframe.ts");

  it("不再从执行链取订阅入口，也不引 withTimeout 兜底", () => {
    expect(firstframe).not.toMatch(/from "\.\/enqueue"/);
    expect(firstframe).not.toMatch(/with-timeout/);
  });

  it("等的是 findExecutionProgress 那一行窄投影（终态 + 产出 + 原因）", () => {
    expect(firstframe).toMatch(/taskRepository\.findExecutionProgress/);
    expect(firstframe).toMatch(/isTerminalTaskStatus/);
    /* 等待节拍与次数收在 `~/lib/retry-policy` 的具名策略里：全库的「几次 /
     * 多久」只在那一处定义（§16.2.4.49），这里不许再长一个字面量。 */
    expect(firstframe).toMatch(/FIRST_FRAME_WAIT/);
  });

  it("窄投影带 error 列：失败原因是用户可见出口，不能只报「失败了」", () => {
    expect(src("src/lib/core/repository-task.ts")).toMatch(
      /async findExecutionProgress[\s\S]{0,400}?error: task\.error/,
    );
  });
});

describe("客户端解析器不留只有一半宿主能收到的帧", () => {
  const client = src("src/lib/workshop/generation-client.ts");

  it("没有 done / error / progress 帧分支：流路由只发 log 与 state", () => {
    expect(client).not.toMatch(/type === "done"/);
    expect(client).not.toMatch(/type === "error"/);
    expect(client).not.toMatch(/type === "progress"/);
    expect(client).toMatch(/type === "state"/);
    expect(client).toMatch(/type === "log"/);
  });

  it("SSE 路由那边确实只发这两种帧（两条判据必须同时成立才闭环）", () => {
    const route = src("src/app/api/tasks/[id]/stream/route.ts");
    expect(route).toMatch(/send\(\{\s*type: "log"/);
    expect(route).toMatch(/type: "state"/);
    expect(route).not.toMatch(/type: "done"/);
    expect(route).not.toMatch(/emitter/);
  });
});
