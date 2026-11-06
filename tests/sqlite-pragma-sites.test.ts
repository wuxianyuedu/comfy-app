/**
 * PRAGMA / 等锁预算的「站点同源」判据（ISSUE #1250，驱动形状重定于 #3171）：①**漂移** —— 库级 PRAGMA 有四处站点（Next 主库、工坊库、执行宿主、非 TS 启动器）要一致，三处 TS 侧 import 同一份清单，启动器只能照抄，故这里逐条核对。
 * ②**形状** —— 运行时已从 `@libsql/client`（`file:` 客户端是连接池，开机 PRAGMA 只落在当时借到的那条连接上）换成 `node:sqlite`（一个进程只有一条 `DatabaseSync` 连接，ISSUE #3171）。单连接下 `PRAGMA busy_timeout` 本身就能覆盖每一条后续语句，所以宿主侧预算已改回顾 PRAGMA；Next 侧仍然不设。下面第 4、5 条用例当场把「有预算 / 没预算」两种形状量出来。
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sleep } from "../src/lib/with-timeout";

import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_PRAGMAS,
  applySqlitePragmas,
  gateProxyWithPragmas,
} from "../src/lib/sqlite-pragmas";
import { SQLITE_PRAGMA_BOOT } from "../src/lib/retry-policy";

const ROOT = path.resolve(import.meta.dirname, "..");
const code = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

/** 三处 TS 连接：Next 主库、工坊 MCP 库、执行宿主自己的库。 */
const TS_SITES = [
  "src/server/db.ts",
  "src/server/workshop/db.ts",
  "src/lib/comfyui/host-runtime.ts",
];

/* ── 行为量具用的临时目录（绝不往仓库 log/ 或库文件里写） ────────────── */
const sandbox = path.join(os.tmpdir(), `sqlite-budget-${process.pid}-${Date.now().toString(36)}`);
const dbFile = path.join(sandbox, "measure.sqlite");
const holderScript = path.join(sandbox, "hold-write-lock.mjs");

/** 外部进程按住的持锁脚本（写位到手打一行 LOCKED，按满 holdMs 再提交）。 */
const HOLDER_SOURCE = `
import { DatabaseSync } from "node:sqlite";
const [file, holdArg] = process.argv.slice(2);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout = 8000");
for (let i = 0; i < 80; i += 1) {
  try {
    db.exec("BEGIN IMMEDIATE");
    break;
  } catch {
    sleep(50);
  }
}
db.prepare("UPDATE t SET v = v WHERE id = 1").run();
console.log("LOCKED");
sleep(Number(holdArg ?? 1500));
db.exec("COMMIT");
db.close();
`;

function runHolder(holdMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [holderScript, dbFile, String(holdMs)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      /* 等它真拿到写位再让争用方开写，否则量的不是争用窗口。 */
      if (out.includes("LOCKED")) {
        resolve();
      }
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`holder exited ${code}`));
      }
    });
  });
}

/** 外部进程按住写位的时长与争用方的预算：预算(5000) > 持锁(1500)，
 *  所以「覆盖得到」的形状应该等到并写成功，「覆盖不到」的应该很快抛 SQLITE_BUSY。
 *  两边相差 1.5 秒以上，判据不靠小数点。 */
const EXTERNAL_HOLD_MS = 1500;
const BUDGET_MS = 5000;

/** 用**一条** `node:sqlite` 连接去撞外部进程按住的写锁（#3171 之后的真形状：
 *  `DatabaseSync` 一个进程一条连接，`PRAGMA busy_timeout` 对它之后的每条语句都生效）。
 *  `none` 是「不设预算」的对照（默认 0ms，撞锁立刻抛）；`pragma` 把 5000ms 写进连接。
 *  两者唯一的差别就是那条 PRAGMA —— 量的东西因此可归因。 */
async function attemptWith(shape: "none" | "pragma") {
  const db = new DatabaseSync(dbFile);
  if (shape === "pragma") {
    db.exec(`PRAGMA busy_timeout = ${BUDGET_MS}`);
  }
  await runHolder(EXTERNAL_HOLD_MS);
  const started = Date.now();
  let outcome: "ok" | "busy" = "ok";
  try {
    db.prepare("UPDATE t SET v = 'contended' WHERE id = 1").run();
  } catch {
    outcome = "busy";
  }
  const elapsed = Date.now() - started;
  db.close();
  return { outcome, elapsed };
}

describe("库级 PRAGMA 清单只有一份定义", () => {
  it("清单本身只有 WAL 与外键，且**不含** busy_timeout（预算不该混进来）", () => {
    expect(SQLITE_PRAGMAS).toEqual(["PRAGMA journal_mode = WAL", "PRAGMA foreign_keys = ON"]);
    /* 这条不是洁癖：把预算放进清单 = 让 Next 两处也无声地背上 250ms 同步停摆，
     * 而「Next 侧不设预算」是签字决定；假的覆盖比没有覆盖更坏。 */
    expect(
      SQLITE_PRAGMAS.some((p) => p.includes("busy_timeout")),
      "等锁预算是连接级属性，由宿主站点自己以 PRAGMA 给，不许回到共用清单",
    ).toBe(false);
    expect(SQLITE_BUSY_TIMEOUT_MS).toBe(250);
  });

  it("三处 TS 站点都只走共用出口（不许再各写一份字面量、也不许各写一遍循环）", () => {
    /* 软断言：三处站点 × 四条判据是**十二格独立的**结论 —— 一处回退不该把
       另外两处的读数一起藏起来（§11.18）。 */
    for (const rel of TS_SITES) {
      const src = code(rel);
      /* 共用出口有两个形态，但都住在 `~/lib/sqlite-pragmas`、都走同一份清单与
       * #1282 撞锁重试：宿主在 async 函数里直接 `await applySqlitePragmas`；
       * Next 两处为避开顶层 await（见下一条用例）走 `gateProxyWithPragmas`。
       * 三处站点要的是同一件事，各写一遍循环就必然漏一处。 */
      expect
        .soft(src, `${rel} 必须走 sqlite-pragmas 的共用出口`)
        .toMatch(/applySqlitePragmas|gateProxyWithPragmas/);
      expect.soft(src, `${rel} 不许各写一份 proxy gate`).not.toContain("await pragmasReady");
      expect
        .soft(src, `${rel} 不该再自己遍历清单`)
        .not.toContain("for (const pragma of SQLITE_PRAGMAS)");
      expect
        .soft(src, `${rel} 不该再硬编码 journal_mode`)
        .not.toContain('"PRAGMA journal_mode = WAL"');
      expect
        .soft(src, `${rel} 不该再硬编码 foreign_keys`)
        .not.toContain('"PRAGMA foreign_keys = ON"');
    }
  });

  it("Next 两处 db 模块不许顶层 await —— async module 会让 class extends 拿到 undefined 基类", () => {
    /* ISSUE #3252：db.ts 顶层的 `await applySqlitePragmas(...)` 让 Turbopack 把
     * 整个 db → repository-base 链编成 async module。`repository-base` 是所有
     * `class X extends DrizzleRepository` 的基类，async module 下子类的 extends
     * 会抢在基类 e.s 导出注册之前求值 ⇒ `Class extends value undefined`
     * （instrumentation hook 加载 film/repository 图时必现，webServer 起不来）。
     * 形状判：模块顶层出现 `await applySqlitePragmas` 即回潮。委托给共用出口
     * `gateProxyWithPragmas`（在 proxy 回调里 gate 那条 promise）是唯一正解。 */
    for (const rel of ["src/server/db.ts", "src/server/workshop/db.ts"]) {
      const src = code(rel);
      expect(src, `${rel} 不许顶层 await PRAGMA 初始化`).not.toMatch(
        /^\s*await\s+applySqlitePragmas\s*\(/m,
      );
      expect(src, `${rel} 必须走 gateProxyWithPragmas 守住同步模块`).toContain(
        "gateProxyWithPragmas",
      );
    }
  });

  it("等锁预算只在执行宿主那一侧，且走的是 PRAGMA busy_timeout", () => {
    const host = code("src/lib/comfyui/host-runtime.ts");
    // node:sqlite 单连接下 PRAGMA 就是正确形状（#3171），所以这里钉的是它而不是客户端选项。
    expect(host).toContain("`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`");
    /* Next 两处的「不设」同样是签字决定，所以要被钉住：回潮就会把界面请求变成
     * 最长 250ms 的同步停摆，而那条停摆既不在本 issue 的收口路径上、也没有测试。 */
    for (const rel of ["src/server/db.ts", "src/server/workshop/db.ts"]) {
      expect(code(rel), `${rel} 不该给 Next 侧设等锁预算`).not.toContain("SQLITE_BUSY_TIMEOUT_MS");
    }
  });

  it("启动器那侧（非 TS 宿主、引不到清单）跑的确实是同一组库级 PRAGMA", () => {
    const src = code("scripts/launcher-core/standalone-runtime-env.mjs");
    for (const pragma of SQLITE_PRAGMAS) {
      /* 逐条按**整句**核对：`.mjs` 里是 `db.exec("PRAGMA …")`，
       * 少一条、或那条被单独改过，都会在这里红。 */
      expect(src, `启动器侧缺一条 PRAGMA：${pragma}`).toContain(`"${pragma}"`);
    }
    /* 它自己那一条 busy_timeout 是**首启建表**的预算，比交互侧长是刻意的：
     * 建表撞上还在跑的宿主时「等一等」比「启动失败」好，而这个进程此刻不服务界面。
     * node:sqlite 是单连接，那里 PRAGMA 就是正确形状（不需要 timeout 选项）。 */
    expect(src).toContain(`"PRAGMA busy_timeout = 2000"`);
  });
});

/**
 * `gateProxyWithPragmas` 的行为量具（ISSUE #3252）：它存在的唯一理由是让 db 模块
 * **同步**导出（Turbopack 不再把它编成 async module），同时仍保证 PRAGMA 在首次
 * 查询前就位。这里用假 handle 把那两件事当场量出来，不碰真库、不赌时机。
 */
describe("gateProxyWithPragmas：同步导出 + 查询前 PRAGMA 就位", () => {
  it("调用同步返回 RemoteCallback，PRAGMA 已排上但不阻塞模块求值", () => {
    const executed: string[] = [];
    const proxy = gateProxyWithPragmas({
      execute: (sql: string) => {
        executed.push(sql);
      },
      proxy: () => Promise.resolve({ rows: [] }),
    });
    /* 关键形状：返回的是函数而不是 Promise —— 顶层 await 已撤，db 模块同步导出。 */
    expect(typeof proxy).toBe("function");
    expect(proxy).not.toBeInstanceOf(Promise);
  });

  it("首次查询会等 PRAGMA 应用完，且查询落到原 proxy", async () => {
    let pragmaDone = false;
    const calls: string[] = [];
    const proxy = gateProxyWithPragmas({
      execute: () => {
        /* 模拟 PRAGMA 是异步完成的一段工作：查询必须排在它之后。 */
        return Promise.resolve().then(() => {
          pragmaDone = true;
        });
      },
      proxy: (sql) => {
        calls.push(sql);
        return Promise.resolve({ rows: [[pragmaDone]] });
      },
    });
    const result = await proxy("select 1", [], "all");
    expect(pragmaDone).toBe(true);
    expect(calls).toEqual(["select 1"]);
    expect(result.rows[0]).toEqual([true]);
  });

  it("PRAGMA 真失败时不产生 unhandledRejection，且在查询处如实抛出", async () => {
    const boom = new Error("read-only mount");
    const proxy = gateProxyWithPragmas({
      execute: () => {
        throw boom;
      },
      proxy: () => Promise.resolve({ rows: [] }),
    });
    /* 先让一个微任务轮次过去：若 ready 的 rejection 没被标记处理，Node 会在这里
     * 报 unhandledRejection（本用例自身会挂）。gate 里的 catch 就是为这一格。 */
    await Promise.resolve();
    await expect(proxy("select 1", [], "all")).rejects.toBe(boom);
  });
});

/* ── 竞态量具的常数 ────────────────────────────────────────────────
 * 必须声明在用例块**之前**：`it()` 的标题是模板串、在**收集期**就求值，把常数放在下面会
 * 撞 TDZ —— 表现是整个文件 "Cannot access 'RACE_PROCS' before initialization"，
 * 而不是某条用例红（那种红长得像判据写坏了）。 */

/**
 * 被量子进程数。7 是照 #1282 现场取的（`next build` 打印 `Collecting page data using 7 workers`）；2026-10-01 同机、`next` 升到 16.3.8 时读到 `using 15 workers` —— 这个数随 CPU 与版本变，别当常量信仰。
 * 仍按 7 跑是**偏保守**一侧：进程更少 ⇒ 窗口更易错开 ⇒ 更易「一次都不抛」，正是它需要多轮的原因之一。
 */
const RACE_PROCS = 7;

/**
 * 等 N 个子进程全部到位的上限。本机 tsx 冷启实测 7.4s、热启 2.2–2.8s，满载更久。上一版写死 10s 且**超时也继续发令**，而错开起跑的形状恰好是「一次都不抛」= 假红（#1337 的一条待分辨可能）。
 * 现在到位不足会明确报出来，不再装作量到了。
 */
const ARRIVAL_DEADLINE_MS = 25_000;

/** 「量具没坏」那一轮最多连跑几轮（见一次抛就停，所以常态下只跑 1 轮）。 */
const RACE_CONTROL_ROUNDS = 6;

/**
 * 单条竞态用例的预算：最坏情况是一轮都没抛、跑满 `RACE_CONTROL_ROUNDS` 轮，每轮都可能
 * 等到位上限。必须显式给 —— 否则是以「超时红」的形态失败，而那条红又会像极了
 * 「前提不成立」，正好是本次要分开的那两种成因。
 */
const RACE_CASE_TIMEOUT_MS = RACE_CONTROL_ROUNDS * (ARRIVAL_DEADLINE_MS + 20_000) + 30_000;

/** 一轮竞态的读数：每个进程的结论 + **实际到位数**（后者是 #1337 补的那一格）。 */
type RaceRound = { arrived: number; outcomes: Array<string> };

/**
 * `applySqlitePragmas` 的**撞锁重试**当场量出来（ISSUE #1282，形状重定于 #1337）。原始现场：`next build` 的 collect-page-data 起多个 worker、各自 import `src/server/db.ts` 都跑开机 PRAGMA，而全新库文件上 `PRAGMA journal_mode = WAL` 要独占锁 ⇒ 抛 `SQLITE_BUSY`（3/8），被聚合成 `Failed to collect page data` 且报错落在无关路由（干净检出上首次 `pnpm build` 必失败、再跑就好）。
 * 抢锁是亚毫秒窗口上的概率事件（同形状 5 轮每轮抛 1/3/0/2/4 次），拿它扛判决会在没坏时红且不可归因（#1179）。故**因果交给下面 describe**（单元层注入 BUSY，只取决于代码形状）；**现场保真留在这一组**：真起 N 个独立进程互撞，但多轮、见一次抛就停，角色只是「这台机器上窗口还在」。
 * 红话必须分得开两种「一次都没抛」：**没齐步**（错开起跑，量到启动抖动）与**每轮都齐了却没人撞锁**（转换形状真的变了）—— 下一步动作完全不同。
 */
describe("开机 PRAGMA 撞锁有界重试，当场量出来", () => {
  it(
    `裸循环在 ${RACE_PROCS} 进程同时打新库时会抛（量具没坏；多轮、见一次抛就停）`,
    async () => {
      const rounds: Array<RaceRound> = [];
      for (let round = 0; round < RACE_CONTROL_ROUNDS; round++) {
        // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
        const r = await racePragmaBoot("bare");
        rounds.push(r);
        /* 见一次抛就收工：常态下第一轮就够（约 3s），只有「今天一直没抛」那种轮次才会跑满。 */
        if (r.outcomes.some((o) => o !== "ok")) {
          break;
        }
      }
      const threw = rounds.reduce((n, r) => n + r.outcomes.filter((o) => o !== "ok").length, 0);
      const desynced = rounds.filter((r) => r.arrived < RACE_PROCS);
      expect(
        threw,
        `${rounds.length} 轮互撞一次都没抛（其中 ${desynced.length} 轮没等齐 ${RACE_PROCS} 个进程）。${
          desynced.length > 0
            ? ` 没齐的那几轮量到的是「错开起跑」而不是「抢不到锁」—— 先查 tsx 冷启与机器负载` +
              `（到位上限 ${ARRIVAL_DEADLINE_MS}ms；本机冷启实测 7.4s、满载更久），别去放宽下面的断言。`
            : ` 每轮都齐步发令却没人撞锁 —— 那才是「WAL 转换不再互斥」这一前提真的变了，` +
              `要按 ISSUE #1337 重新定性这条对照，而不是把它删掉。`
        }`,
      ).toBeGreaterThan(0);
    },
    RACE_CASE_TIMEOUT_MS,
  );

  it(
    `applySqlitePragmas 在同样形状下全绿（且这一轮确实齐步过）`,
    async () => {
      const r = await racePragmaBoot("retry");
      /* 这一条的结论「出口扛得住真互撞」只有在那批进程确实同窗起跑时才成立；
       * 没齐就跑绿的「全绿」是什么都没判的全绿，所以要当场拦下来而不是默认相信。 */
      expect(
        r.arrived,
        `只有 ${r.arrived}/${RACE_PROCS} 个进程在 ${ARRIVAL_DEADLINE_MS}ms 内到位 —— 错开起跑的话` +
          `「全绿」什么也没判（成因见上：tsx 冷启 / 机器负载）。`,
      ).toBe(RACE_PROCS);
      expect(
        r.outcomes.filter((o) => o !== "ok"),
        `有进程仍抛：${r.outcomes.filter((o) => o !== "ok").join(" / ")}`,
      ).toEqual([]);
    },
    RACE_CASE_TIMEOUT_MS,
  );
});

/* ── 单元层：把 BUSY **注入**进来，确定性地量「出口与裸循环的差别」──────────
 * 为什么这一层要存在（#1337）：进程互撞的窗口是亚毫秒概率事件（同形状 5 轮抛 1/3/0/2/4 次），
 * 拿它扛判决会在什么都没坏时红。因果改由这里钉：结果只取决于代码形状，不取决于时机。
 * 四条用例对着四个分支：重试到成功 / 非锁族一次都不重试 / 穷尽照样抛（抛原错误）/
 * 同形状下裸循环第一次就抛（量具没坏的等价物，不需要任何运气）。 */

/** 一条会按脚本抛错的假连接。 */
function scriptedTarget(
  failures: number,
  err: { code?: string; message: string } = {
    code: "SQLITE_BUSY",
    message: "database is locked",
  },
): { calls: Array<string>; execute(sql: string): Promise<unknown> } {
  const target: { calls: Array<string>; execute(sql: string): Promise<unknown> } = {
    calls: [],
    execute(sql: string): Promise<unknown> {
      target.calls.push(sql);
      if (target.calls.length <= failures) {
        throw Object.assign(
          new Error(err.message),
          err.code !== undefined && err.code !== "" ? { code: err.code } : {},
        );
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return target;
}

/** 修复前那个形状：没有容错的裸循环（等价于 #1282 之前三处站点各写一遍的那段）。 */
async function bareLoop(
  target: { execute(sql: string): Promise<unknown> },
  pragmas: ReadonlyArray<string>,
): Promise<void> {
  for (const pragma of pragmas) {
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
    await target.execute(pragma);
  }
}

describe("撞锁重试的因果（单元层：注入 BUSY，不赌时机）", () => {
  it("锁族错误连续出现时，出口重试到成功 —— 同一条 PRAGMA 试了 3 次才过", async () => {
    const target = scriptedTarget(2);
    await expect(applySqlitePragmas(target, SQLITE_PRAGMAS)).resolves.toBeUndefined();
    /* 前 3 次都是 WAL（抛、抛、成），第 4 次才是 foreign_keys。
     * 认次数而不是认耗时：等没等由退避常数决定，本机负载会改它，而次数不会说谎。 */
    expect(target.calls).toEqual([
      SQLITE_PRAGMAS[0],
      SQLITE_PRAGMAS[0],
      SQLITE_PRAGMAS[0],
      SQLITE_PRAGMAS[1],
    ]);
  });

  it("非锁族错误：原样抛，且一次都不重试（认不出原因就退避 = 把真故障拖成慢故障）", async () => {
    /* 消息里也不能带锁族短语 —— `isSqliteBusyError` 有「只看 message」的兜底分支
     * （下面那条用例钉的就是它），所以这里给一句真·结构错误。第一版写的是
     * code=SQLITE_ERROR + message="database is locked"，结果被判成锁族重试了：
     * 那是夹具写错，不是判据错。 */
    const target = scriptedTarget(1, {
      code: "SQLITE_ERROR",
      message: "no such table: task",
    });
    await expect(applySqlitePragmas(target, SQLITE_PRAGMAS)).rejects.toMatchObject({
      code: "SQLITE_ERROR",
    });
    expect(target.calls.length).toBe(1);
  });

  it("驱动只给 message、不给 code 时仍按锁族重试（那条兜底分支是有用的，别删）", async () => {
    const target = scriptedTarget(2, { message: "database is locked" });
    await expect(applySqlitePragmas(target, SQLITE_PRAGMAS)).resolves.toBeUndefined();
    expect(target.calls.length).toBe(4);
  });

  it(`一直撞锁：穷尽后照样抛，且正好试 ${SQLITE_PRAGMA_BOOT.maxAttempts} 次`, async () => {
    const target = scriptedTarget(99);
    await expect(applySqlitePragmas(target, SQLITE_PRAGMAS)).rejects.toMatchObject({
      code: "SQLITE_BUSY",
    });
    expect(target.calls.length).toBe(SQLITE_PRAGMA_BOOT.maxAttempts);
  });

  it("同一份注入交给裸循环：第一次 BUSY 就抛 —— 出口存在的理由就是这一格", async () => {
    const target = scriptedTarget(1);
    await expect(bareLoop(target, SQLITE_PRAGMAS)).rejects.toMatchObject({
      code: "SQLITE_BUSY",
    });
    expect(target.calls.length).toBe(1);
  });
});

/* ── 竞态量具：N 个**独立进程**同时把一份新库切到 WAL（ISSUE #1282，形状重定于 #1337）─
 * 必须跨进程：同进程只有一条 node:sqlite 连接（#3171），串行执行天然不抢锁；只有独立进程才
 * 复现「别人正拿独占锁」那一档（`next build` 的 collect-page-data worker 正是独立进程）。
 * 已实测否掉的替代方案：让另一进程持 `BEGIN EXCLUSIVE` 造确定性撞锁不成立 —— 持锁时攻方执行
 * `PRAGMA journal_mode = WAL` 直接返回 `wal`，既不抛也不 no-op。故因果交单元层，进程层只负责「现场还在」。 */
let raceRoundSeq = 0;

const raceSandbox = path.join(ROOT, "node_modules", ".cache", `sqlite-pragma-race-${process.pid}`);

/** 子进程脚本源码：`mode=bare` 是修复前的形状（裸循环），`mode=retry` 走真出口。被测的是**真模块**
 * （不是复制一份逻辑：复制等于量一个副本，改了真文件也不会红）。路径用相对仓库根那条
 * （`../../../src/lib/...`）而非 `~/lib/...`：脚本落在 `node_modules/.cache`，tsx 的 paths 认
 * 「离文件最近的 tsconfig」，在 `node_modules` 里这条路不通。语法用 ESM：脚本是 `.mts`，顶层 await
 * 才成立（esbuild 对 `.ts` 在非 module 包下按 CJS 转译，直接报 Top-level await 不支持）。 */
const RACE_WORKER_SOURCE = `
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/* 被测模块的**绝对路径**由父进程作为 argv[1] 传来：写成脚本里的相对路径就要数
 * 「这个脚本相对仓库根有几层」—— 那个数会随沙箱目录深度漂移，实测正是它把
 * 进程变成 ERR_MODULE_NOT_FOUND（子进程崩了、结论却长得像「撞锁失败」）。 */
const [moduleUrl, startFile, file, mode] = process.argv.slice(2);
const { applySqlitePragmas, SQLITE_PRAGMAS } = await import(moduleUrl);
const spin = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* 到位标记：父进程靠它确认「人都齐了」再发令 —— **必须写在等发令之前**，
 * 否则就是死锁：子进程等 startFile、父进程等到位数。 */
writeFileSync(startFile + ".arrived." + process.pid, "");

/* 起跑线：tsx 的启动抖动有几十到几百毫秒，不齐步的话各进程的 PRAGMA 会被错开、
 * 抢不到同一个窗口（实测那样量出来「一次都不抛」，量到的是启动抖动而不是抢锁）。
 * 所有人先在这里等同一个文件出现，再一起冲。 */
while (!existsSync(startFile)) spin(2);
/* 抢占窗口只有几毫秒：再多等一小会儿，让最后一个进程也到位。 */
spin(30);

/* #3171 之后的真形状：一个进程一条 node:sqlite 连接，PRAGMA 直接走 exec。 */
const db = new DatabaseSync(file);
try {
  if (mode === "retry") {
    await applySqlitePragmas({ execute: (sql) => db.exec(sql) });
  } else {
    for (const pragma of SQLITE_PRAGMAS) db.exec(pragma);
  }
  console.log("ok");
} catch (err) {
  console.log("fail:" + (err?.code ?? err?.message ?? "unknown"));
} finally {
  db.close();
}
`;

/** 被量子进程加载的模块：**绝对 file: URL**（见 worker 源码里那段说明）。 */
const PRAGMA_MODULE_URL = pathToFileURL(path.join(ROOT, "src", "lib", "sqlite-pragmas.ts")).href;

/** 跑一轮 N 进程竞态，返回每个进程的结论（`ok` / `fail:CODE` / `exit:N`）**以及实际到位数**。流程：
 * 起 N 个子进程（各自在 `while (!existsSync(startFile))` 上自旋等发令）→ 等各回一个 `.arrived.<pid>`
 * → 落盘 `startFile`（发令）→ 收结论。少了齐步，量到的是「启动抖动」而不是「抢锁」（实测会一次
 * 都不抛）。到位数一并返回：#1337 之后它属于判据的一部分 ——「没齐也发令」的那一轮不能算量到了。 */
async function racePragmaBoot(mode: "bare" | "retry"): Promise<RaceRound> {
  /* 每一轮一个**独立目录**：库文件、齐步文件、到位标记、子进程脚本都关在里面 ——
   * 共用目录时上一轮的 `.arrived.*` 会被这一轮数进来，「人都齐了」就是假的。
   * 序号 + 时间戳两个都带上：多轮可以在同一毫秒内开跑，只靠时间戳会撞同一个目录。 */
  const dir = path.join(raceSandbox, `${mode}-${++raceRoundSeq}-${Date.now().toString(36)}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "race.sqlite");
  const startFile = path.join(dir, "go");
  const worker = path.join(dir, "worker.mts");
  writeFileSync(worker, RACE_WORKER_SOURCE, "utf8");

  /* 先起进程（它们各自在 `while (!existsSync(startFile))` 上自旋等发令），
   * 等齐到位数再发令，这样所有人的 PRAGMA 落在同一个几毫秒窗口里。 */
  const pending = Array.from({ length: RACE_PROCS }, () =>
    runOnce(worker, PRAGMA_MODULE_URL, startFile, file, mode),
  );
  const arrived = await waitForArrivals(startFile, RACE_PROCS);
  /* 发令：这一步之后所有进程几乎同时执行 PRAGMA。到位不足也发令 —— 但把数带回去，
   * 由调用方决定这一轮算不算数（#1337：不许「没齐也装作量到了」）。 */
  writeFileSync(startFile, "");
  const outcomes = await Promise.all(pending);
  return { outcomes, arrived };
}

/**
 * 等 `expectCount` 个 `.arrived.<pid>` 出现，返回**实际到位数**。上一版是「上限 10s，超时也继续」且不回报 —— tsx 冷启（实测 7.4s）或满载逼近上限时，这一轮会在只有部分进程就绪时发令，而那批错开起跑的形状恰好是「一次都不抛」。
 * 到位数现在进 `RaceRound`，由用例判它自己那条结论还成不成立。
 */
async function waitForArrivals(startFile: string, expectCount: number): Promise<number> {
  const dir = path.dirname(startFile);
  const base = `${path.basename(startFile)}.arrived.`;
  const deadline = Date.now() + ARRIVAL_DEADLINE_MS;
  let arrived = 0;
  while (Date.now() < deadline) {
    arrived = readdirSync(dir).filter((n) => n.startsWith(base)).length;
    if (arrived >= expectCount) {
      return arrived;
    }
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
    await sleep(10);
  }
  return arrived;
}

/** tsx 的 CLI 入口：按包自己的 exports 表解析（`tsx/cli`），不硬编码 `dist/cli.mjs`，
 *  也不去碰 `pnpm` 那个平台分叉的壳 —— 见 `runOnce` 里那段 EINVAL 的说明（ISSUE #638）。 */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

/** 起一个进程跑 worker，取它 stdout 的第一行；非零退出也算一条结论。 */
function runOnce(
  worker: string,
  moduleUrl: string,
  startFile: string,
  file: string,
  mode: string,
): Promise<string> {
  return new Promise((resolve) => {
    /* 子进程**直接由 node 起 tsx**，不经 `pnpm exec`：Windows 上 `pnpm` 是 `.cmd`/`.ps1` 壳，而 Node ≥ 24 起批处理必须先经过 shell —— `spawn("pnpm.cmd", …)` 一律 `EINVAL`（ISSUE #638，`scripts/check-format.cjs` 文件头就是它）。
     * 也不能改成复用 `pnpmInvocation()`：那条在本机解析成 pwsh 起 `pnpm.ps1`，每个子进程多一层 shell 启动抖动，而这里量的正是几毫秒窗口里的 PRAGMA 竞态。
     * tsx 的入口按**它自己的 exports 表**解析（`tsx/cli`），不硬编码 `dist/cli.mjs`；CWD 仍是仓库根 —— 只有这样才能加载真模块（`src/lib/sqlite-pragmas.ts` 还要 import `~/lib/**`，别名由仓库根 tsconfig 解析）。 */
    const child = spawn(process.execPath, [TSX_CLI, worker, moduleUrl, startFile, file, mode], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("exit", (code) => {
      const line = out.split("\n").find((l) => l.trim());
      resolve(line?.trim() ?? `exit:${code}`);
    });
  });
}

describe("等锁预算的两种形状，当场量出来", () => {
  it("不设预算：撞上外部写锁立刻抛（fail-fast 是 Next 侧刻意保留的形状）", async () => {
    const { outcome, elapsed } = await attemptWith("none");
    expect(outcome, "不设预算却不抛 —— 量具坏了").toBe("busy");
    expect(
      elapsed,
      `不设预算却等了 ${elapsed}ms：说明有一条我们没设过的预算，本文件的前提已不成立`,
    ).toBeLessThan(EXTERNAL_HOLD_MS);
  });

  it("PRAGMA busy_timeout 覆盖单连接上的每一条语句：短锁被等到并写成功", async () => {
    const { outcome, elapsed } = await attemptWith("pragma");
    expect(outcome).toBe("ok");
    expect(elapsed, "写成功却几乎没等：说明外部根本没按住，量具坏了").toBeGreaterThanOrEqual(300);
  });

  it(`宿主那一侧的预算（${SQLITE_BUSY_TIMEOUT_MS}ms）比一次真锁短，所以穷尽路径是常备路径`, () => {
    /* 这条把两件事钉在一起：预算只有 250ms ⇒ 稍长的锁必然走到 writeTerminal 的
     * 重试与穷尽；也就是说「设了预算」不等于「不必重试」，别把后者当前者删掉。 */
    expect(SQLITE_BUSY_TIMEOUT_MS).toBeLessThan(EXTERNAL_HOLD_MS);
  });
});

/* 夹具：一次性建库 + 落持锁脚本，两个 describe 都读它。
 * 必须放在**用例之前**跑（`beforeAll`），否则 `dbFile` 还不存在、
 * `runHolder` 也找不到脚本 —— 上一版把建库写在文件末尾的用例块之外，
 * 于是「连接失败」和「量具坏了」在这条用例里长得一模一样。 */
beforeAll(() => {
  mkdirSync(sandbox, { recursive: true });
  mkdirSync(raceSandbox, { recursive: true });
  writeFileSync(holderScript, HOLDER_SOURCE, "utf8");
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.exec("INSERT INTO t (id, v) VALUES (1, 'x')");
  db.close();
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${dbFile}${suffix}`, { force: true });
    } catch {
      /* Windows 上连接还没散时会锁文件；临时目录由系统回收 */
    }
  }
  rmSync(holderScript, { force: true });
  try {
    rmdirSync(sandbox);
  } catch {
    /* 非空就留给系统 */
  }
  /* 竞态那组用的是自己的沙箱（库文件 + 子进程脚本），同一口径清掉。 */
  rmSync(raceSandbox, { recursive: true, force: true });
});
