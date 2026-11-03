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
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const COMFYUI_DIR = "src/lib/comfyui";
/* 判据针对的是**代码**：这几处退役的理由就写在注释里（「不再有
 * `s.emitter.emit`」这类句子会自己把自己判红），所以先剥注释再匹配。
 * `{ trailing: true }` 那一档管的是**行尾**那半（`const x = 1; // 别再用 emitter`
 * 也是同一种自打自，只是不在整行上）。 */
const stripCode = (text: string): string => stripComments(text, { trailing: true });
const src = (rel: string): string => stripCode(readFileSync(path.join(ROOT, rel), "utf8"));

/**
 * 执行链的文件名规则：`executor*` / `runner-state*` / `enqueue` / `reaper` / `firstframe`。
 *
 * 面是**从目录派生**的，不是一份手抄清单：手抄清单在「把一个大文件拆成几个」之后
 * 只会**少判**，而少判在这一族反向断言上的表现是 `not.toMatch` 恒真 —— 账面读数与
 * 「真的退役干净」逐字相同。派生规则把那一格变成「新文件自动在面里」。
 * 排除 `*.test.*`：夹具里造一个 `EventEmitter` 是正当写法，不该被这条判红。
 */
const EXEC_CHAIN_PATTERN = /^(?:executor|runner-state|enqueue|reaper|firstframe)/;
const execChainFiles = (): Array<string> =>
  readdirSync(path.join(ROOT, COMFYUI_DIR))
    .filter((name) => /\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name))
    .filter((name) => EXEC_CHAIN_PATTERN.test(name.replace(/\.tsx?$/, "")))
    .map((name) => `${COMFYUI_DIR}/${name}`)
    .sort();

const CHAIN = execChainFiles();

/** 这一族读的全部源（执行链 + 三条别处判据要交叉对账的接收者）。 */
const READ_FILES = [
  ...CHAIN,
  "src/lib/core/repository-task.ts",
  "src/lib/workshop/generation-client.ts",
  "src/app/api/tasks/[id]/stream/route.ts",
];

describe("进程内事件通道（EventEmitter）已退役", () => {
  /* 前置断言：下面每一组的反向断言都以「读到了东西」为前提。少了这一组，
   * 派生面为空、或某份文件被搬成只剩一行 re-export 时，全部 `not.toMatch`
   * 会在不判任何东西的情况下绿。 */
  it("这一族读的面非空：派生规则有命中、且每份文件剥完注释仍有代码", () => {
    expect(CHAIN.length, "执行链派生面为空 ⇒ 下面那组 `emitter` 断言全在判空文").toBeGreaterThan(0);
    // 历史上真正持有 emitter 的那几份必须在面里：它们不在 = 规则或文件名漂了，覆盖面静默缩小。
    for (const name of [
      "enqueue.ts",
      "executor.ts",
      "runner-state.ts",
      "runner-state-shape.ts",
      "reaper.ts",
    ]) {
      expect(
        CHAIN,
        `执行链面里不见了 ${name} —— 派生规则没命中它了，这条「任何模块都不再持有 emitter」` +
          "会变成只判剩下那几份",
      ).toContain(`${COMFYUI_DIR}/${name}`);
    }
    for (const rel of READ_FILES) {
      expect(src(rel).trim(), `${rel}：剥完注释是空文，落在它身上的反向断言恒真`).not.toHaveLength(
        0,
      );
    }
  });

  it.for(CHAIN)("%s 里没有 emitter 的构造、持有或投递", (rel) => {
    expect(src(rel)).not.toMatch(/emitter/i);
  });

  it("判据本身有效：整行注释与行尾注释都不算，代码里的 emitter 算", () => {
    // 三头都要验：走的是 `stripCode` 本身（不是另调一次 `stripComments`），
    // 否则「上面那组忘了传 `{ trailing: true }`」这一形不会被这条抓住。
    expect(stripCode("// 这里过去写着 s.emitter.emit(taskId, …)\nconst ok = 1;\n")).not.toMatch(
      /emitter/i,
    );
    expect(stripCode("const ok = 1; // 这里过去写着 s.emitter.emit\n")).not.toMatch(/emitter/i);
    expect(stripCode('const s = state();\ns.emitter.emit(taskId, { type: "done" });\n')).toMatch(
      /emitter/i,
    );
  });

  it("RunnerState 的初值工厂不再收 EventEmitter，事件形状 TaskEvent 也不存在了", () => {
    const shape = src("src/lib/comfyui/runner-state-shape.ts");
    expect(shape).not.toMatch(/export type TaskEvent/);
    expect(shape).not.toMatch(/from "events"/);
    expect(shape).toMatch(/export function createEmptyState\(\)/);
  });

  it("enqueue 不再导出 subscribe（零消费导出的判据由 check-dead-exports 兜）", () => {
    expect(src("src/lib/comfyui/enqueue.ts")).not.toMatch(/export function subscribe/);
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
