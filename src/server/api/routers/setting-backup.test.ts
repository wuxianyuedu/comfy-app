/**
 * `setting.backupList` / `backupCreate` / `backupRestore` 的契约（D6 / ISSUE #1611）。
 *
 * 这三个 procedure 是「备份与恢复」那一页的唯一服务端出口，要钉住的是**它们各自
 * 守住了什么** —— 三条都不是「调了函数就完事」的形态：
 *
 *   1. `backupCreate` 失败时**返回 `{ ok: false, reason }` 而不是抛** —— 备份失败
 *      是可预期的一档（磁盘满 / 库被独占），界面上要能看见「为什么没成」，
 *      而不是一句网络错误的笼统文案；
 *   2. `backupRestore` **只写待恢复标记**，绝不就地换文件 —— 运行期有多个进程
 *      持有这个库，就地覆盖 `db.sqlite` 是不可逆的数据事故。这条用例同时断言
 *      「库文件一个字节都没动」；
 *   3. 名字是**请求方给的字符串**，必须过「是不是这个目录里认得出的备份名」这道
 *      闸 —— 否则「恢复」会变成「用任意文件覆盖数据库」。
 *
 * 走**真实现**（真临时目录、真 `node:sqlite` 库），不 mock 核心 —— 这三条判据
 * 的错法全在「真的动了哪个文件」上，mock 断言不到。`process.cwd()` 被指到临时
 * 目录（产品代码一律按 `process.cwd()` 解析应用根）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 这两个替身与 `setting.test.ts` 同口径（该文件头解释了为什么必须：tRPC 的
 * context 构造会连带加载 better-auth，而它的 env 校验要求一份 `.env`）。
 * 本文件要验的是备份那三条 procedure，与认证 / 数据库无关。 */
vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { settingRouter } from "~/server/api/routers/setting";
import { makeCtx } from "../../../../tests/helpers/trpc";
import { BACKUP_DIR } from "../../../../scripts/db-backup-core.mjs";

const createCaller = createCallerFactory(settingRouter);

let root: string;
let realCwd: string;

/** 造一份有数据的真库（`db.sqlite` 落在「应用根」那一层）。 */
function seedDb(): void {
  const db = new DatabaseSync(path.join(root, "db.sqlite"));
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.exec("INSERT INTO t (v) VALUES ('seed')");
  } finally {
    db.close();
  }
}

beforeEach(() => {
  realCwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "setting-backup-"));
  /* 产品代码一律按 `process.cwd()` 解析应用根（`backupDir` / `resolveSqlitePath`），
   * 所以这里把 cwd 指到临时目录 —— 不碰仓库的真实 `db.sqlite` 与 `data/`。 */
  process.chdir(root);
  seedDb();
});

afterEach(() => {
  process.chdir(realCwd);
  fs.rmSync(root, { force: true, recursive: true });
});

describe("setting.backupCreate", () => {
  it("成功时回 ok + 名字，且清单里立刻看得到", async () => {
    const caller = createCaller(makeCtx());
    const result = await caller.backupCreate();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.name).toMatch(/^db-backup-\d{8}-\d{6}(-\d+)?\.sqlite$/);

    const listed = await caller.backupList();
    expect(listed.backups.map((b) => b.name)).toContain(result.name);
  });

  it("数据库不存在时**返回失败原因**，不抛", async () => {
    fs.rmSync(path.join(root, "db.sqlite"));
    const caller = createCaller(makeCtx());
    const result = await caller.backupCreate();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("不存在");
  });
});

describe("setting.backupList", () => {
  it("没有备份时回空清单、也没有待恢复标记（不是报错）", async () => {
    const caller = createCaller(makeCtx());
    const listed = await caller.backupList();
    expect(listed.backups).toEqual([]);
    expect(listed.pending).toBeNull();
  });
});

describe("setting.backupRestore", () => {
  it("只写标记：库文件一个字节都没动", async () => {
    const caller = createCaller(makeCtx());
    const made = await caller.backupCreate();
    /* 断言而不是抛：本文件被 `src/server/api/routers/**` 那条 lint 规则扫到，
     * 裸 `throw new Error` 会被判成「router 里抛裸 Error」（§11.2.1 第七条）。
     * 这里本来也不是在测失败路径。 */
    expect(made.ok, JSON.stringify(made)).toBe(true);
    if (!made.ok) {
      return;
    }
    const before = fs.readFileSync(path.join(root, "db.sqlite"));

    const result = await caller.backupRestore({ name: made.name });
    expect(result.ok).toBe(true);

    // ① 标记写下了
    const listed = await caller.backupList();
    expect(listed.pending?.file).toBe(made.name);
    // ② 库文件**没动**（换文件在下次启动，不是在这一刻）
    expect(fs.readFileSync(path.join(root, "db.sqlite")).equals(before)).toBe(true);
  });

  it("拒绝任意路径 / 穿越 / 不存在的名字（恢复不是「用任意文件覆盖数据库」）", async () => {
    const caller = createCaller(makeCtx());
    await caller.backupCreate();
    for (const bad of [
      "../../../etc/passwd",
      "db.sqlite",
      "not-a-backup.sqlite",
      "db-backup-19990101-000000.sqlite",
    ]) {
      const result = await caller.backupRestore({ name: bad });
      expect(result.ok, `${bad} 不该被接受`).toBe(false);
    }
    // 一次都不该留下标记
    const listed = await caller.backupList();
    expect(listed.pending).toBeNull();
  });
});

describe("落点", () => {
  it("备份落在 <应用根>/data/backups/，不在项目根旁边", async () => {
    const caller = createCaller(makeCtx());
    const made = await caller.backupCreate();
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    expect(fs.existsSync(path.join(root, BACKUP_DIR, made.name))).toBe(true);
    expect(fs.existsSync(path.join(root, made.name))).toBe(false);
  });
});
