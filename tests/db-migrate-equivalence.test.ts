/**
 * 契约：**版本化迁移与 `db:push` 产出同一份 schema**（ISSUE #1624 验收第 2 条）。
 *
 * 为什么要单独钉这一条：`drizzle/0000_*.sql` 是**生成物**，而生成它的那一刻
 * `schema.ts` 是什么样、用的 drizzle-kit 是哪一版，都可能与「下一次有人跑
 * `db:push`」不同。两条路一旦漂开，`db:migrate` 建出来的库就与代码期望的结构
 * 不一致 —— 而它**不会报错**（表都在、列名都对得上大半），只在某个业务写入上炸。
 *
 * 判据取**逐表逐列**的结构比对，不是「表数相同」：后者挡不住「少一列 / 类型不对 /
 * NOT NULL 丢了」这一类 —— 而那正是本仓反复踩过的形态（`db-push.mjs` 的
 * 第二次复核就是为「有表但结构不对」加的）。
 *
 * 两条真跑路径都要付出起 drizzle 的代价（各 ~3-5s），所以这里**共用一次临时目录**
 * 与**一次** `db:push`：用例本身不是热路径，重复跑两遍 drizzle 只会让这个文件
 * 在 CI 上无谓地变慢（`check-test-concurrency` 也盯着并发档，别用 `it.concurrent`
 * 绕成本）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** 一张表的可比结构：列（名/类型/非空/主键）+ 索引名。 */
interface TableShape {
  cols: string;
  idx: string;
}

let tmp: string;
/** `db:migrate` 建出来的库。 */
let migratedDb: string;
/** `db:push` 建出来的库（对照组）。 */
let pushedDb: string;

/** 读一个库的全部用户表结构（排除 sqlite 内部表与 drizzle 账本表）。 */
function readShape(file: string): Record<string, TableShape> {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(file)}, { readOnly: true, open: true });
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name"
    ).all().map((r) => r.name);
    const out = {};
    for (const n of names) {
      const cols = db.prepare("PRAGMA table_info(" + n + ")").all()
        .map((c) => c.name + ":" + c.type + (c.notnull ? " NOT NULL" : "") + (c.pk ? " PK" : ""))
        .join(",");
      const idx = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all(n).map((r) => r.name).join(",");
      out[n] = { cols, idx };
    }
    db.close();
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    throw new Error(`读库结构失败：${r.stderr}`);
  }
  return JSON.parse(r.stdout) as Record<string, TableShape>;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-migrate-eq-"));
  migratedDb = path.join(tmp, "migrated.sqlite");
  pushedDb = path.join(tmp, "pushed.sqlite");

  const migrate = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "db-migrate.mjs")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${migratedDb}` },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    },
  );
  if (migrate.status !== 0) {
    throw new Error(`db:migrate 失败：${migrate.stderr || migrate.stdout}`);
  }

  const push = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "db-push.mjs")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: `file:${pushedDb}` },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    },
  );
  if (push.status !== 0) {
    throw new Error(`db:push 失败：${push.stderr || push.stdout}`);
  }
}, 600_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("db:migrate ⇄ db:push 的 schema 等价", () => {
  it("两条路建出的库都不空（否则下面的等价断言是空对空）", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    expect(Object.keys(a).length, "migrate 没建出表").toBeGreaterThan(10);
    expect(Object.keys(b).length, "push 没建出表").toBeGreaterThan(10);
  });

  it("表集合一致", () => {
    const a = Object.keys(readShape(migratedDb)).sort();
    const b = Object.keys(readShape(pushedDb)).sort();
    expect(a).toEqual(b);
  });

  it("逐表逐列一致（列名 / 类型 / NOT NULL / 主键）", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    const mismatches: string[] = [];
    for (const name of Object.keys(a)) {
      /* `noUncheckedIndexedAccess` 下 `a[name]` 是 `T | undefined` —— 这里用
       * 解构取出来并显式收窄，而不是 `!` 断言：断言会把「键不在」这类真问题
       * 一起咽掉（上面那条 `!b[name]` 的 continue 已经表达了「只在两边都有时比」）。 */
      const left = a[name];
      const right = b[name];
      if (!left || !right) continue;
      if (left.cols !== right.cols) {
        mismatches.push(
          `${name}:\n  migrate=${left.cols}\n  push   =${right.cols}`,
        );
      }
    }
    expect(mismatches, "迁移生成物与 schema.ts 漂开了").toEqual([]);
  });

  it("索引集合一致", () => {
    const a = readShape(migratedDb);
    const b = readShape(pushedDb);
    const mismatches: string[] = [];
    for (const name of Object.keys(a)) {
      const left = a[name];
      const right = b[name];
      if (!left || !right) continue;
      if (left.idx !== right.idx) {
        mismatches.push(`${name}: migrate=[${left.idx}] push=[${right.idx}]`);
      }
    }
    expect(mismatches, "索引漂开（外键/唯一约束常在这里暴露）").toEqual([]);
  });

  it("迁移是幂等的：连跑两次第二次不改结构", () => {
    const before = readShape(migratedDb);
    const r = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "db-migrate.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: `file:${migratedDb}` },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      },
    );
    expect(r.status, "第二次迁移必须是 no-op 且 exit 0").toBe(0);
    expect(readShape(migratedDb)).toEqual(before);
  }, 300_000);
});
