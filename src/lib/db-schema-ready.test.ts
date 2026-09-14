/**
 * `db-schema-ready.test.ts` — 「表还没建时，模块级副作用不许把进程带崩」
 *
 * 这是一条**构建期故障**的回归护栏：`next build` 的 collect-page-data /
 * prerender 阶段会为每条路由起 worker 加载模块图，而 `enqueue.ts` 以裸副作用
 * 形式把 `reaper`（启动即读 `task` 表）挂上了启动路径。干净检出（CI / 新克隆）
 * 上 `db.sqlite` 还没建（`pnpm db:push` 尚未执行），于是 build 期间读库抛
 * `no such table: task`，构建死在 collect-page-data 阶段 —— 报错行号落在
 * 与该库无关的路由文件上，CI 的 `pnpm build` 门禁长期红。
 *
 * 三条契约：
 *   1. 表不存在 / 库文件不存在 → `isSchemaReady()` 为 false（不抛）；
 *   2. 表存在 → true（不能把「探测永远 false」当成修好了）；
 *   3. reaper 在表未就绪时**不读库**（不是「读崩了再说」）。
 *
 * 本用例用临时目录里的真实 sqlite 文件驱动，不 mock fs —— 探测逻辑本身
 * 就是「路径 + sqlite_master」，mock 掉等于什么都没验。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let dbFile: string;

/** 建一个只含哨兵表 `task` 的 sqlite（表结构取本项目 schema 的最小子集）。 */
function createSchema(file: string): void {
  execFileSync(
    process.execPath,
    [
      "-e",
      `const { DatabaseSync } = require("node:sqlite");
       const db = new DatabaseSync(${JSON.stringify(file)});
       db.exec("CREATE TABLE task (id TEXT PRIMARY KEY, status TEXT)");
       db.close();`,
    ],
    { stdio: "pipe" },
  );
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-schema-ready-"));
  dbFile = path.join(tmp, "db.sqlite");
  const mod = await import("./db-schema-ready");
  mod.resetSchemaReadinessCache();
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("probeSchemaSync", () => {
  it("库文件不存在（干净检出、还没 db:push）时返回 unknown，而不是抛异常", async () => {
    const { probeSchemaSync } = await import("./db-schema-ready");
    expect(fs.existsSync(dbFile)).toBe(false);
    expect(() => probeSchemaSync()).not.toThrow();
    expect(probeSchemaSync()).toBe("unknown");
  });

  it("库文件存在但哨兵表还没建时返回 missing", async () => {
    fs.writeFileSync(dbFile, "");
    const { probeSchemaSync } = await import("./db-schema-ready");
    expect(probeSchemaSync()).toBe("missing");
  });

  it("哨兵表建好后返回 ready —— 保证判定不是「永远 false」", async () => {
    createSchema(dbFile);
    const { probeSchemaSync } = await import("./db-schema-ready");
    expect(probeSchemaSync()).toBe("ready");
  });

  it("接受显式 DATABASE_URL（与 src/server/db.ts 同一锚点口径）", async () => {
    createSchema(dbFile);
    const { probeSchemaSync } = await import("./db-schema-ready");
    expect(probeSchemaSync(`file:${dbFile}`)).toBe("ready");
  });
});

describe("isSchemaReady 缓存", () => {
  it("同进程内只探一次：建表后缓存仍为 false（调用方每轮自行重探的语义由 sweep 决定）", async () => {
    const { isSchemaReady, resetSchemaReadinessCache } = await import("./db-schema-ready");
    expect(isSchemaReady()).toBe(false);
    createSchema(dbFile);
    // 缓存命中，不会因为库刚建好就翻牌
    expect(isSchemaReady()).toBe(false);
    // 显式重置后重新探测 → true
    resetSchemaReadinessCache();
    expect(isSchemaReady()).toBe(true);
  });
});

describe("reaper 模块级副作用", () => {
  it("表未就绪时加载 reaper 不读库（旧实现在此处抛 no such table）", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = `file:${dbFile}`;
    const repository = await import("./core/repository");
    const listStaleQueued = vi.spyOn(repository.taskRepository, "listStaleQueued");

    await expect(import("./comfyui/reaper")).resolves.toBeTruthy();
    // 副作用是 fire-and-forget：给异步 sweeper 一点时间落定
    await new Promise((r) => setTimeout(r, 50));

    expect(listStaleQueued).not.toHaveBeenCalled();
    listStaleQueued.mockRestore();
    delete process.env.DATABASE_URL;
  });
});
