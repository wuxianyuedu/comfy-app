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
 *
 * 两条**确定性**约束（缺了就会在 CI / 干净检出上假红，ISSUE #489）：
 *   - `process.cwd` 的 mock 必须**按用例生效**，不能放进文件级 `beforeEach`：
 *     文件级钩子对该文件里所有 `describe` 都生效，而下面「reaper 模块级副作用」
 *     那组要 `import` 真实的 `~/server/db` → `~/env`，`env.js` 会拿
 *     `<cwd>/../.env` 探测配置文件。cwd 被留在临时目录时该探测必然落空 →
 *     抛 `MissingEnvFileError`，用例与「表就绪守卫」毫无关系地失败（本机有
 *     `.env` 时又是绿的，于是一条只在 CI 红的假回归）。故 cwd 的替身只在本
 *     `describe` 内建立、退出即还原。
 *   - 该组必须自己把环境「造齐」（`SKIP_ENV_VALIDATION` + 隔离的
 *     `DATABASE_URL`），不去读开发者本机的 `.env`：用例的可通过性只能取决于
 *     用例自己造的东西，不能取决于「本机碰巧有没有 `.env`」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;
let dbFile: string;

/** 本文件临时目录的前缀：既是建目录用的名字，也是「扫上一轮」的认领域判据。 */
const TMP_PREFIX = "db-schema-ready-";

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

/** 建临时目录并把 `process.cwd()` 指向它 —— 只在本 `describe` 内生效。
 *  返回的还原函数必须在 `afterEach` 里调用：cwd 替身一旦泄漏到后面的
 *  `describe`，就会把 `~/env` 的 `.env` 探测带偏（见文件头「两条确定性约束」）。 */
function useTempCwd(): { restore: () => void } {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  dbFile = path.join(tmp, "db.sqlite");
  const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmp);
  return { restore: () => cwdSpy.mockRestore() };
}

/**
 * 扫掉**上一轮**留下的临时目录。
 *
 * 为什么不在这里删自己那份：libsql 的 sqlite 句柄由它的工作线程持有，
 * `client.close()` 既不返回 Promise，实测句柄还要 **1–9s** 才释放（并行负载下
 * 更久且没有上界）—— 本文件此前在 `afterEach` 里带 `maxRetries` 删，就是在赌这个
 * 不确定的窗口，安静机赶得上、108 文件一起跑就赶不上（表现为只在钩子里红一次的
 * EPERM，隔离跑反而绿）。进程内「等到能删为止」是把不确定量搬进关键路径；改成
 * 下一轮开头扫一次，既不留垃圾，也永远不会因为锁而红。
 *
 * 只认自己的前缀，且跳过 60s 内还在写的目录（同机可能另有一条 vitest 正在用）。
 */
function sweepStaleTempDirs(): void {
  const base = os.tmpdir();
  let names: string[];
  try {
    names = fs.readdirSync(base);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(TMP_PREFIX)) continue;
    const full = path.join(base, name);
    try {
      if (Date.now() - fs.statSync(full).mtimeMs < 60_000) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // 还被别的进程占着：这轮不删，下一轮再来（删除是尽力，不是契约）。
    }
  }
}

sweepStaleTempDirs();

afterEach(() => {
  vi.restoreAllMocks();
  /* 关掉挂在单例上的客户端（`NODE_ENV !== "production"` 时 `~/server/db` 会把它
   * 留在 `globalThis.db`）。这一步是卫生，不是「让删得掉」—— 真正的释放要等
   * 线程结束，见上面 `sweepStaleTempDirs` 的说明。 */
  const cached = (
    globalThis as unknown as {
      db?: { $client?: { close?: () => void } };
    }
  ).db;
  cached?.$client?.close?.();
});

describe("probeSchemaSync", () => {
  let cwd: { restore: () => void };
  beforeEach(async () => {
    cwd = useTempCwd();
    const mod = await import("./db-schema-ready");
    mod.resetSchemaReadinessCache();
  });
  afterEach(() => cwd.restore());

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
  let cwd: { restore: () => void };
  beforeEach(async () => {
    cwd = useTempCwd();
    const mod = await import("./db-schema-ready");
    mod.resetSchemaReadinessCache();
  });
  afterEach(() => cwd.restore());

  it("同进程内只探一次：建表后缓存仍为 false（调用方每轮自行重探的语义由 sweep 决定）", async () => {
    const { isSchemaReady, resetSchemaReadinessCache } =
      await import("./db-schema-ready");
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
  /** 这一组要真正加载 `~/server/db` → `~/env`，所以得自己把环境造齐：
   *  `SKIP_ENV_VALIDATION` 让 `env.js` 不再要求 `.env` 文件存在（本机有没有
   *  `.env` 都不影响结果），`DATABASE_URL` 指向本用例自己的临时库。
   *  `vi.stubEnv` 在 afterEach 的 `vi.unstubAllEnvs()` 里自动还原。 */
  let cwd: { restore: () => void };

  beforeEach(async () => {
    cwd = useTempCwd();
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    const mod = await import("./db-schema-ready");
    mod.resetSchemaReadinessCache();
  });

  afterEach(async () => {
    cwd.restore();
    vi.unstubAllEnvs();
    /* 这一组真的打开了 `~/server/db` 的 libsql 连接（指向临时库）。不关的话
     * Windows 上文件句柄不释放，文件级 afterEach 的 `rmSync` 会 EPERM。 */
    const { closeDb } = await import("~/server/db");
    closeDb();
  });

  it("表未就绪时启动 reaper 不读库（旧实现在此处抛 no such table）", async () => {
    vi.resetModules();
    // `env.js` 由 `vi.stubEnv` 的 SKIP_ENV_VALIDATION 放行后，仍会校验必填项；
    // 两处密钥按「占位值」给出，等价于 CI 里 `pnpm test` 的真实条件。
    vi.stubEnv("BETTER_AUTH_GITHUB_CLIENT_ID", "test-client-id");
    vi.stubEnv("BETTER_AUTH_GITHUB_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("DATABASE_URL", `file:${dbFile}`);

    const repository = await import("./core/repository");
    const listStaleUnownedQueued = vi.spyOn(
      repository.taskRepository,
      "listStaleUnownedQueued",
    );

    /* 加载模块本身已不再起回收器（ADR §14 D3），所以这里必须**显式**起一次：
     * 否则本用例只验了「什么都没发生」，判据会静默失效——要验的是「起了表、
     * 而表还没就绪时不读库」。 */
    const reaper = await import("./comfyui/reaper");
    reaper.startReaper();
    // 首扫是 fire-and-forget：给异步 sweeper 一点时间落定
    await new Promise((r) => setTimeout(r, 50));

    expect(listStaleUnownedQueued).not.toHaveBeenCalled();
    listStaleUnownedQueued.mockRestore();
  });
});
