/**
 * 回归护栏：**`db:migrate` 在前提不成立时会留下 0 字节库**（ISSUE #1624）。
 *
 * 缺陷形态（实测，无 TTY）：`drizzle-kit migrate` 在 `drizzle/` 目录缺失时
 * **先建出库文件、再退 1** —— 于是 `db.sqlite` 是一个 0 字节的空壳。调用方拿到
 * 的是一个看起来像「迁移失败」的退出码 + 一个坏掉的库，而下一个动作（起应用）
 * 才炸成 `no such table`，那时已经看不出是谁干的。
 *
 * 这与 `tests/db-push-noninteractive.test.ts` 护的是**同一族**（ISSUE #489 的
 * 「报错 + 留空库」），只是 `push` 那条早就修了、`migrate` 这条路没有。
 *
 * 四条契约：
 *   1. `pnpm db:migrate` 走 `scripts/db-migrate.mjs`（不是裸 `drizzle-kit migrate`）；
 *   2. **前置判决**：没有迁移文件时，它在起 drizzle-kit **之前**就拦下 ——
 *      这才是「不留 0 字节库」的机制（事后复核只能发现，不能阻止）；
 *   3. 判定依据是**库里的真事实**（表数 + 账本条数），不是 drizzle-kit 的退出码；
 *   4. 真跑：前提不成立时非零退出，**且不产出 0 字节库**。
 *
 * 用例在**真仓库里跑**（不是搭一个沙箱检出）：被测脚本的顶层 import 会一路链到
 * `src/lib/process/executable-resolve.ts`，把那条链整棵拷进沙箱等于重造半个仓库，
 * 而那样测的就不再是「真仓库里的这条命令」了。前提用**真目录的移开/放回**控制，
 * 库路径用 `DATABASE_URL` 指到临时目录（与 `db-push-noninteractive.test.ts` 同法）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmp: string;
let dbFile: string;
/** 真仓库里的迁移目录；用例期间可能被临时挪开。 */
const REAL_DRIZZLE = path.join(process.cwd(), "drizzle");
let moved: string | null = null;

/** 把真 `drizzle/` 挪到一边（返回备份路径）；已经在一边时返回 null。 */
function hideMigrations(): string | null {
  if (!fs.existsSync(REAL_DRIZZLE)) return null;
  const bak = `${REAL_DRIZZLE}.test-bak-${process.pid}`;
  fs.renameSync(REAL_DRIZZLE, bak);
  return bak;
}

function restoreMigrations(): void {
  if (moved && fs.existsSync(moved)) {
    fs.rmSync(REAL_DRIZZLE, { recursive: true, force: true });
    fs.renameSync(moved, REAL_DRIZZLE);
  }
  moved = null;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-migrate-"));
  dbFile = path.join(tmp, "db.sqlite");
});

afterEach(() => {
  restoreMigrations();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 在真仓库里跑迁移入口（`stdio` 全 pipe：无 TTY，正是要复现的环境）。 */
function runMigrate(databaseUrl = `file:${dbFile}`) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "db-migrate.mjs")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    },
  );
}

describe("pnpm db:migrate 非交互可用", () => {
  it("package.json 的 db:migrate 经 scripts/db-migrate.mjs，而不是裸 drizzle-kit migrate", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    // 裸 `drizzle-kit migrate` 在前提不成立时「先建库、再退 1、留空壳」（实测）。
    expect(pkg.scripts["db:migrate"]).toBe("node scripts/db-migrate.mjs");
    expect(pkg.scripts["db:migrate"]).not.toContain("drizzle-kit");
  });

  it("判定依据是库里的真事实（表数 + 账本），不是 drizzle-kit 的退出码", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-migrate.mjs"),
      "utf8",
    );
    expect(src).toContain("countUserTables");
    expect(src).toContain("appliedMigrations");
    // 退出码在这条链路上不可信（实测：先建 0 字节库、再退 1），源码里必须写明。
    expect(src).toContain("不看退出码");
  });

  it("前置判决按 .sql 筛，而不是「目录在不在」", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-migrate.mjs"),
      "utf8",
    );
    // 「目录在、但一份迁移都没有」与「目录不在」是同样建不出库的现场，
    // 判据只认前者的话会漏过去。
    expect(src).toContain('.endsWith(".sql")');
    expect(src).toContain("files.length === 0");
  });
});

describe("前提不成立时：非零退出，且不产出 0 字节库", () => {
  it("没有迁移文件 → 前置判决拦下，库文件**根本没被创建**", () => {
    moved = hideMigrations();
    expect(fs.existsSync(REAL_DRIZZLE), "前置条件：迁移目录已被挪开").toBe(false);

    const r = runMigrate();

    expect(r.status, "前提不成立必须非零退出").not.toBe(0);
    expect(r.stderr).toContain("db:migrate");
    // 核心断言：**不留 0 字节库**。裸 drizzle-kit 在这里会先建文件、再退 1。
    expect(
      fs.existsSync(dbFile),
      "前置判决必须在起 drizzle-kit 之前拦下 —— 否则它会先建出 0 字节的库",
    ).toBe(false);
  }, 150_000);

  it("库不可写（父目录不存在）→ 非零退出并指名原因", () => {
    const r = runMigrate(`file:${path.join(tmp, "no-such-dir", "db.sqlite")}`);
    expect(r.status, "建不出库时必须非零退出").not.toBe(0);
    expect(r.stderr).toContain("db:migrate");
  }, 150_000);
});
