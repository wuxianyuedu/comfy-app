/**
 * PRAGMA / 等锁预算的「站点同源」判据（ISSUE #1250）。
 *
 * 这里判的是两件各自会**静默失效**的事：
 *
 * 1. **漂移**：库级 PRAGMA 有四处站点要一致（Next 主库、工坊库、执行宿主、非 TS 的
 *    启动器）。三处 TS 侧 import 同一份清单是编译期同源；启动器引不到它，只能照抄，
 *    所以由本文件按清单**逐条**核对。
 * 2. **形状错**：等锁预算曾经也放进那份清单里，看着像「四处都设了」，实测却只对
 *    其中一条连接生效 —— `@libsql/client` 的 `file:` 客户端是**连接池**，池上限
 *    `Math.max(1, config.concurrency)` 在未配 `concurrency` 时是 `NaN`，也就是
 *    「永远没到上限」，于是池随时会新开一条**没见过开机那条 PRAGMA** 的连接。
 *    桌包实演读到的正是这个后果：宿主的 4 次终态重试挤在 0.6 秒里跑完（每次都秒抛），
 *    而不是每次等满预算。正确形状是客户端的 `timeout` 选项，由驱动在**建立每条连接**
 *    时设好。下面第 4、5 条用例就是当场把这两种形状量出来，而不是留一句注释相信它。
 *
 * 预算给在宿主（250ms）而不给 Next 侧，是签字决定，理由写进 `src/lib/sqlite-pragmas.ts`
 * 文件头：libsql 的语句执行是同步的，等锁多少毫秒，本进程的事件循环就停摆多少毫秒。
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sleep } from "../src/lib/with-timeout";

import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_PRAGMAS,
  applySqlitePragmas,
} from "../src/lib/sqlite-pragmas";
import { SQLITE_PRAGMA_BOOT } from "../src/lib/retry-policy";

const ROOT = path.resolve(import.meta.dirname, "..");
const code = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

/** 三处 TS 连接：Next 主库、工坊 MCP 库、执行宿主自己的库。 */
const TS_SITES = [
  "src/server/db.ts",
  "src/server/workshop/db.ts",
  "src/lib/comfyui/host-runtime.ts",
];

/* ── 行为量具用的临时目录（绝不往仓库 log/ 或库文件里写） ────────────── */
const sandbox = path.join(
  os.tmpdir(),
  `sqlite-budget-${process.pid}-${Date.now().toString(36)}`,
);
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
    const child = spawn(
      process.execPath,
      [holderScript, dbFile, String(holdMs)],
      {
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      /* 等它真拿到写位再让争用方开写，否则量的不是争用窗口。 */
      if (out.includes("LOCKED")) resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`holder exited ${code}`));
    });
  });
}

/** 外部进程按住写位的时长与争用方的预算：预算(5000) > 持锁(1500)，
 *  所以「覆盖得到」的形状应该等到并写成功，「覆盖不到」的应该很快抛 SQLITE_BUSY。
 *  两边相差 1.5 秒以上，判据不靠小数点。 */
const EXTERNAL_HOLD_MS = 1500;
const BUDGET_MS = 5000;

/** 用**同一个客户端**开一个不提交的读事务，占住池里那条连接，
 *  逼后面那次写去新开一条 —— 只有新开的那条才区分得出「开机 PRAGMA」与
 *  「客户端 timeout 选项」：前者跟不到它身上，后者由驱动在建立时设好。
 *  （上一版把占用者放进了另一个 client，被测 client 的池始终是空的，
 *  于是「PRAGMA 形状」量出来是写成功，把要判的漂移直接量没了。） */
async function attemptWith(shape: "pragma" | "option") {
  const url = `file:${dbFile}`;
  const client =
    shape === "option"
      ? createClient({ url, timeout: BUDGET_MS })
      : createClient({ url });
  if (shape === "pragma") {
    for (const pragma of [
      ...SQLITE_PRAGMAS,
      `PRAGMA busy_timeout = ${BUDGET_MS}`,
    ]) {
      await client.execute(pragma);
    }
  }
  const blocker = await client.transaction("read");
  await runHolder(EXTERNAL_HOLD_MS);
  const started = Date.now();
  let outcome: "ok" | "busy" = "ok";
  try {
    await client.execute("UPDATE t SET v = 'contended' WHERE id = 1");
  } catch {
    outcome = "busy";
  }
  const elapsed = Date.now() - started;
  await blocker.rollback().catch(() => undefined);
  client.close();
  return { outcome, elapsed };
}

describe("库级 PRAGMA 清单只有一份定义", () => {
  it("清单本身只有 WAL 与外键，且**不含** busy_timeout（预算不该混进来）", () => {
    expect(SQLITE_PRAGMAS).toEqual([
      "PRAGMA journal_mode = WAL",
      "PRAGMA foreign_keys = ON",
    ]);
    /* 这条不是洁癖：把预算放进清单 = 让「四处都设了」这句话重新变成假的
     * （池后开的连接读不到它），而假的判据比没有判据更坏。 */
    expect(
      SQLITE_PRAGMAS.some((p) => p.includes("busy_timeout")),
      "等锁预算必须由客户端 timeout 选项给，不许回到 PRAGMA 清单",
    ).toBe(false);
    expect(SQLITE_BUSY_TIMEOUT_MS).toBe(250);
  });

  it("三处 TS 站点都只走共用出口（不许再各写一份字面量、也不许各写一遍循环）", () => {
    /* 软断言：三处站点 × 四条判据是**十二格独立的**结论 —— 一处回退不该把
       另外两处的读数一起藏起来（§11.18）。 */
    for (const rel of TS_SITES) {
      const src = code(rel);
      /* 出口是 `applySqlitePragmas`（清单 + 撞锁重试都在它里面，ISSUE #1282）：
       * 三处站点要的是同一件事，各写一遍循环就必然漏一处。 */
      expect.soft(src, `${rel} 必须 import 共用出口`).toContain(
        "applySqlitePragmas",
      );
      expect.soft(src, `${rel} 不该再自己遍历清单`).not.toContain(
        "for (const pragma of SQLITE_PRAGMAS)",
      );
      expect.soft(src, `${rel} 不该再硬编码 journal_mode`).not.toContain(
        '"PRAGMA journal_mode = WAL"',
      );
      expect.soft(src, `${rel} 不该再硬编码 foreign_keys`).not.toContain(
        '"PRAGMA foreign_keys = ON"',
      );
    }
  });

  it("等锁预算只在执行宿主那一侧，且走的是 timeout 选项", () => {
    const host = code("src/lib/comfyui/host-runtime.ts");
    expect(host).toContain("timeout: SQLITE_BUSY_TIMEOUT_MS");
    /* Next 两处的「不设」同样是签字决定，所以要被钉住：回潮就会把界面请求变成
     * 最长 250ms 的同步停摆，而那条停摆既不在本 issue 的收口路径上、也没有测试。 */
    for (const rel of ["src/server/db.ts", "src/server/workshop/db.ts"]) {
      expect(code(rel), `${rel} 不该给 Next 侧设等锁预算`).not.toContain(
        "SQLITE_BUSY_TIMEOUT_MS",
      );
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

/* ── 竞态量具的常数 ────────────────────────────────────────────────
 * 必须声明在用例块**之前**：`it()` 的标题是模板串、在**收集期**就求值，把常数放在下面会
 * 撞 TDZ —— 表现是整个文件 "Cannot access 'RACE_PROCS' before initialization"，
 * 而不是某条用例红（那种红长得像判据写坏了）。 */

/**
 * 被量子进程数。
 *
 * 7 是照 #1282 当时的现场取的（`next build` 打印 `Collecting page data using 7 workers`）。
 * 2026-10-01 同一台机器、`next` 已升到 16.3.8 的那次构建读到的是 **`using 15 workers`** ——
 * 这个数会随 CPU 与版本变，别把它当常量信仰。这里仍按 7 跑是**偏保守**的一侧：进程更少
 * ⇒ 窗口更容易错开 ⇒ 更容易「一次都不抛」，正是它需要多轮的原因之一。
 */
const RACE_PROCS = 7;

/**
 * 等 N 个子进程全部到位的上限。本机 tsx 冷启一轮实测 7.4s、热启 2.2–2.8s，满载更久。
 * 上一版写死 10s 且**超时也继续发令**，而那批进程错开起跑的形状恰好是「一次都不抛」=
 * 假红（#1337 的一条待分辨可能，本机没触发但它是条会静默降级的通道）。现在到位不足会
 * 明确报出来，不再装作量到了。
 */
const ARRIVAL_DEADLINE_MS = 25_000;

/** 「量具没坏」那一轮最多连跑几轮（见一次抛就停，所以常态下只跑 1 轮）。 */
const RACE_CONTROL_ROUNDS = 6;

/**
 * 单条竞态用例的预算：最坏情况是一轮都没抛、跑满 `RACE_CONTROL_ROUNDS` 轮，每轮都可能
 * 等到位上限。必须显式给 —— 否则是以「超时红」的形态失败，而那条红又会像极了
 * 「前提不成立」，正好是本次要分开的那两种成因。
 */
const RACE_CASE_TIMEOUT_MS =
  RACE_CONTROL_ROUNDS * (ARRIVAL_DEADLINE_MS + 20_000) + 30_000;

/** 一轮竞态的读数：每个进程的结论 + **实际到位数**（后者是 #1337 补的那一格）。 */
type RaceRound = { outcomes: string[]; arrived: number };

/**
 * `applySqlitePragmas` 的**撞锁重试**当场量出来（ISSUE #1282，形状重定于 #1337）。
 *
 * 原始现场：`next build` 的 collect-page-data 会起多个 worker 进程，每个都 import
 * `src/server/db.ts`、于是每个都跑一遍开机 PRAGMA，而**一份全新的库文件**上
 * `PRAGMA journal_mode = WAL` 要独占锁 —— 实测会抛 `SQLITE_BUSY`（#1282 那轮记的是
 * 3/8），异常从模块顶层 await 浮出 worker 就被 Next 聚合成 `Failed to collect page data`，
 * 报错行还落在无关路由上。现场形态是「干净检出上第一次 `pnpm build` 必失败、再跑一次就好」。
 *
 * **为什么这一组只剩一条断言的一半**（#1337 的归因，读数都是本机 2026-10-01 量的）：
 * 「几个进程同时抢那份独占转换窗口」这件事本身是**亚毫秒窗口上的概率事件** —— 同形状跑
 * 5 轮，每轮抛的次数是 1 / 3 / 0 / 2 / 4；也就是说单轮「一次都没抛」的概率约 1/5，而它
 * 并不指示任何回归。把它当判决用，代价是这条判据会在没坏的时候红（实测真用例 3 跑 2 绿 1 红），
 * 而红不可归因的判据久了就没人看（ISSUE #1179 记的就是这个下场）。
 *
 * 所以形状改成两半各归其位：
 *   · **因果交给下面那个 describe**（单元层注入 BUSY，确定性地量「裸循环第一次就抛 /
 *     出口会等且最终成功 / 非锁族一次都不重试 / 穷尽照样抛」）—— 判决不再依赖运气；
 *   · **现场保真留在这一组**：仍然真起 N 个独立进程互撞，但改成**多轮、见一次抛就停**
 *     （P50 成本与单轮一样，只有真出问题的那次才会跑满）。它现在的角色是「这台机器上
 *     这个窗口还在」，不再单独扛因果。
 *
 * 红话必须分得开两种「一次都没抛」：**没齐步**（错开起跑，量到的是启动抖动）与
 * **每轮都齐了却没人撞锁**（转换形状真的变了）—— 这两件事的下一步动作完全不同。
 */
describe("开机 PRAGMA 撞锁有界重试，当场量出来", () => {
  it(
    `裸循环在 ${RACE_PROCS} 进程同时打新库时会抛（量具没坏；多轮、见一次抛就停）`,
    async () => {
      const rounds: RaceRound[] = [];
      for (let round = 0; round < RACE_CONTROL_ROUNDS; round++) {
        const r = await racePragmaBoot("bare");
        rounds.push(r);
        /* 见一次抛就收工：常态下第一轮就够（约 3s），只有「今天一直没抛」那种轮次才会跑满。 */
        if (r.outcomes.some((o) => o !== "ok")) break;
      }
      const threw = rounds.reduce(
        (n, r) => n + r.outcomes.filter((o) => o !== "ok").length,
        0,
      );
      const desynced = rounds.filter((r) => r.arrived < RACE_PROCS);
      expect(
        threw,
        `${rounds.length} 轮互撞一次都没抛（其中 ${desynced.length} 轮没等齐 ${RACE_PROCS} 个进程）。` +
          (desynced.length > 0
            ? ` 没齐的那几轮量到的是「错开起跑」而不是「抢不到锁」—— 先查 tsx 冷启与机器负载` +
              `（到位上限 ${ARRIVAL_DEADLINE_MS}ms；本机冷启实测 7.4s、满载更久），别去放宽下面的断言。`
            : ` 每轮都齐步发令却没人撞锁 —— 那才是「WAL 转换不再互斥」这一前提真的变了，` +
              `要按 ISSUE #1337 重新定性这条对照，而不是把它删掉。`),
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
 *
 * 为什么这一层要存在（#1337）：上面那组进程互撞的窗口是亚毫秒级的概率事件（同形状 5 轮
 * 实测每轮抛 1 / 3 / 0 / 2 / 4 次），拿它扛判决就会在什么都没坏的时候红。因果改由这里钉：
 * 结果只取决于代码形状，不取决于时机。两半各归其位之后，进程层那一组才回归它真正的角色
 * —— 「这台机器上这个窗口还在」。
 *
 * 四条用例对着 `applySqlitePragmas` 的四个分支：重试到成功 / 非锁族一次都不重试 /
 * 穷尽照样抛（且抛的是原错误）/ 同一形状下裸循环第一次就抛。最后那条就是「量具没坏」
 * 在单元层的等价物 —— 它不需要任何运气。 */

/** 一条会按脚本抛错的假连接。 */
function scriptedTarget(
  failures: number,
  err: { code?: string; message: string } = {
    code: "SQLITE_BUSY",
    message: "database is locked",
  },
): { calls: string[]; execute(sql: string): Promise<unknown> } {
  const target: { calls: string[]; execute(sql: string): Promise<unknown> } = {
    calls: [],
    async execute(sql: string): Promise<unknown> {
      target.calls.push(sql);
      if (target.calls.length <= failures) {
        throw Object.assign(
          new Error(err.message),
          err.code ? { code: err.code } : {},
        );
      }
      return { rows: [] };
    },
  };
  return target;
}

/** 修复前那个形状：没有容错的裸循环（等价于 #1282 之前三处站点各写一遍的那段）。 */
async function bareLoop(
  target: { execute(sql: string): Promise<unknown> },
  pragmas: readonly string[],
): Promise<void> {
  for (const pragma of pragmas) await target.execute(pragma);
}

describe("撞锁重试的因果（单元层：注入 BUSY，不赌时机）", () => {
  it("锁族错误连续出现时，出口重试到成功 —— 同一条 PRAGMA 试了 3 次才过", async () => {
    const target = scriptedTarget(2);
    await expect(
      applySqlitePragmas(target, SQLITE_PRAGMAS),
    ).resolves.toBeUndefined();
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
    await expect(
      applySqlitePragmas(target, SQLITE_PRAGMAS),
    ).rejects.toMatchObject({ code: "SQLITE_ERROR" });
    expect(target.calls.length).toBe(1);
  });

  it("驱动只给 message、不给 code 时仍按锁族重试（那条兜底分支是有用的，别删）", async () => {
    const target = scriptedTarget(2, { message: "database is locked" });
    await expect(
      applySqlitePragmas(target, SQLITE_PRAGMAS),
    ).resolves.toBeUndefined();
    expect(target.calls.length).toBe(4);
  });

  it(`一直撞锁：穷尽后照样抛，且正好试 ${SQLITE_PRAGMA_BOOT.maxAttempts} 次`, async () => {
    const target = scriptedTarget(99);
    await expect(
      applySqlitePragmas(target, SQLITE_PRAGMAS),
    ).rejects.toMatchObject({ code: "SQLITE_BUSY" });
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
 *
 * 为什么必须跨进程：同进程内的多条连接会被驱动自己串行化（实测 7 条连接跑同一个
 * 循环全绿），只有独立进程才复现得出「别人正拿独占锁」那一档。`next build` 的
 * collect-page-data worker 正是独立进程。
 *
 * 顺带记一条**已被实测否掉**的替代方案（免得下一个人再想一遍）：想用「另一个进程持住
 * `BEGIN EXCLUSIVE`」造出确定性的撞锁是不成立的 —— 本机真测：持锁方在时攻方执行
 * `PRAGMA journal_mode = WAL` 直接返回 `wal`，既不抛也不静默 no-op。这条通道上唯一
 * 能挡住 WAL 转换的就是**另一个进程正在同一瞬间转换**，而那本质是概率事件 —— 所以
 * 因果交给单元层注入，进程层只负责「现场还在」。 */
let raceRoundSeq = 0;

const raceSandbox = path.join(
  ROOT,
  "node_modules",
  ".cache",
  `sqlite-pragma-race-${process.pid}`,
);

/** 子进程脚本源码：`mode=bare` 是修复前的形状（裸循环），`mode=retry` 走真出口。
 *
 *  被测的是**真模块**（不是复制一份逻辑）：复制逻辑等于量一个副本，改了真文件也不会红。
 *  路径用**相对仓库根**的那条（`../../../src/lib/...`），不用 `~/lib/...`：子进程脚本
 *  落在 `node_modules/.cache` 下，tsx 的 paths 解析认的是「离文件最近的 tsconfig」——
 *  在 `node_modules` 里这条路不通。语法用 ESM：脚本是 `.mts`，顶层 await 才成立
 *  （esbuild 对 `.ts` 在非 module 包下按 CJS 转译，直接报 Top-level await 不支持）。 */
const RACE_WORKER_SOURCE = `
import { existsSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

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

const client = createClient({ url: "file:" + file });
try {
  if (mode === "retry") {
    await applySqlitePragmas(client);
  } else {
    for (const pragma of SQLITE_PRAGMAS) await client.execute(pragma);
  }
  console.log("ok");
} catch (err) {
  console.log("fail:" + (err?.code ?? err?.message ?? "unknown"));
}
`;

/** 被量子进程加载的模块：**绝对 file: URL**（见 worker 源码里那段说明）。 */
const PRAGMA_MODULE_URL = pathToFileURL(
  path.join(ROOT, "src", "lib", "sqlite-pragmas.ts"),
).href;

/** 跑一轮 N 进程竞态，返回每个进程的结论（`ok` / `fail:CODE` / `exit:N`）**以及实际到位数**。
 *
 *  流程：起 N 个子进程（它们各自在 `while (!existsSync(startFile))` 上自旋等发令）→
 *  等所有子进程各回一个 `.arrived.<pid>` → 落盘 `startFile`（= 发令）→ 收结论。
 *  少了齐步这一步，量到的是「启动抖动」而不是「抢锁」（实测会一次都不抛）。
 *  到位数一并返回：#1337 之后它属于判据的一部分 —— 「没齐也发令」的那一轮不能算量到了。 */
async function racePragmaBoot(mode: "bare" | "retry"): Promise<RaceRound> {
  /* 每一轮一个**独立目录**：库文件、齐步文件、到位标记、子进程脚本都关在里面 ——
   * 共用目录时上一轮的 `.arrived.*` 会被这一轮数进来，「人都齐了」就是假的。
   * 序号 + 时间戳两个都带上：多轮可以在同一毫秒内开跑，只靠时间戳会撞同一个目录。 */
  const dir = path.join(
    raceSandbox,
    `${mode}-${++raceRoundSeq}-${Date.now().toString(36)}`,
  );
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
 * 等 `expectCount` 个 `.arrived.<pid>` 出现，返回**实际到位数**。
 *
 * 上一版是「上限 10s，超时也继续」且不回报 —— 于是 tsx 冷启（本机实测 7.4s）或满载
 * 逼近上限时，这一轮会在只有部分进程就绪时发令，而那批进程错开起跑的形状恰好是
 * 「一次都不抛」（文件里另一处注释早就点过这个形态）。到位数现在进 `RaceRound`，
 * 由用例判它自己那条结论还成不成立。
 */
async function waitForArrivals(
  startFile: string,
  expectCount: number,
): Promise<number> {
  const dir = path.dirname(startFile);
  const base = path.basename(startFile) + ".arrived.";
  const deadline = Date.now() + ARRIVAL_DEADLINE_MS;
  let arrived = 0;
  while (Date.now() < deadline) {
    arrived = readdirSync(dir).filter((n) => n.startsWith(base)).length;
    if (arrived >= expectCount) return arrived;
    await sleep(10);
  }
  return arrived;
}

/** 起一个进程跑 worker，取它 stdout 的第一行；非零退出也算一条结论。 */
function runOnce(
  worker: string,
  moduleUrl: string,
  startFile: string,
  file: string,
  mode: string,
): Promise<string> {
  return new Promise((resolve) => {
    /* 子进程**直接由 node 起 tsx**，不经 `pnpm exec`：Windows 上 `pnpm` 是 `.cmd`/`.ps1`
     * 壳，而 Node ≥ 24 起批处理必须先经过 shell —— `spawn("pnpm.cmd", …)` 一律
     * `EINVAL`（本仓为这件事记过账，ISSUE #638，`scripts/check-format.cjs` 文件头就是它）。
     * 这一组要同时起 7 个进程抢同一个新库，所以也不能改成「复用 `pnpmInvocation()`」——
     * 那条在本机会解析成 pwsh 起 `pnpm.ps1`，每个子进程多一层 shell 启动抖动，
     * 而这套量具量的正是几毫秒窗口里的 PRAGMA 竞态（文件里另一处注释已经在抱怨启动抖动）。
     * tsx 的入口按**它自己的 exports 表**解析（`tsx/cli`），不硬编码 `dist/cli.mjs`。
     * CWD 仍是仓库根 —— 只有这样才能加载真模块（`src/lib/sqlite-pragmas.ts` 还要 import
     * `~/lib/**`，别名由仓库根的 tsconfig 解析）。 */
    const child = spawn(
      process.execPath,
      [TSX_CLI, worker, moduleUrl, startFile, file, mode],
      { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] },
    );
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

/** tsx 的 CLI 入口：按包自己的 exports 表解析（`tsx/cli`），不硬编码 `dist/cli.mjs`，
 *  也不去碰 `pnpm` 那个平台分叉的壳 —— 见 `runOnce` 里那段 EINVAL 的说明（ISSUE #638）。 */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

describe("等锁预算的两种形状，当场量出来", () => {
  it("开机 PRAGMA 覆盖不到池里新开的连接（那种形状等于没设）", async () => {
    const { outcome, elapsed } = await attemptWith("pragma");
    expect(outcome, "PRAGMA 形状不该写成功 —— 量具坏了").toBe("busy");
    expect(
      elapsed,
      `PRAGMA 形状等了 ${elapsed}ms：说明它覆盖到了，本文件的前提已不成立`,
    ).toBeLessThan(EXTERNAL_HOLD_MS);
  });

  it("timeout 选项覆盖每一条连接：短锁被等到并写成功", async () => {
    const { outcome, elapsed } = await attemptWith("option");
    expect(outcome).toBe("ok");
    expect(
      elapsed,
      "写成功却几乎没等：说明外部根本没按住，量具坏了",
    ).toBeGreaterThanOrEqual(300);
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
