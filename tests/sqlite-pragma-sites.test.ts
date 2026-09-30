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
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_PRAGMAS,
} from "../src/lib/sqlite-pragmas";

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

  it("三处 TS 站点都只走那份清单（不许再各写一份字面量）", () => {
    for (const rel of TS_SITES) {
      const src = code(rel);
      expect(src, `${rel} 必须 import 共用清单`).toContain("SQLITE_PRAGMAS");
      expect(src, `${rel} 不该再硬编码 journal_mode`).not.toContain(
        '"PRAGMA journal_mode = WAL"',
      );
      expect(src, `${rel} 不该再硬编码 foreign_keys`).not.toContain(
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
});
