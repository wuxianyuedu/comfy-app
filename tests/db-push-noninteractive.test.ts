/**
 * 回归护栏：**Linux / CI 首次上手链路的两个静默失败**（ISSUE #489）。
 *
 * 缺陷 2：`pnpm db:push` 在无 TTY 环境下报 `Interactive prompts require a TTY
 * terminal` 后 **exit 0**，并把 `db.sqlite` 留成 **0 字节**。调用方看到「成功」，
 * 随后 `/`、`/api/health` 都 200，只有真实业务路由 500（`no such table`）。
 *
 * 两条契约：
 *   1. `pnpm db:push` 走 `scripts/db-push.mjs`（不是裸 `drizzle-kit push`）——
 *      裸命令会在无 TTY 上静默失败，脚本以 `--force` 运行并**复核库里有没有表**；
 *   2. 探测判据同源：`.mjs`（dev/start 用）与 `.ts`（应用用）必须认同一张哨兵表、
 *      同一套路径锚点，否则「入口说没建、应用说建了」会互相打架。
 *
 * 用例走**真跑**：造真实 sqlite 文件驱动两边探测，不 mock fs（探测逻辑本身就是
 * 「路径 + sqlite_master」，mock 掉等于什么都没验）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmp: string;
let dbFile: string;

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

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-push-"));
  dbFile = path.join(tmp, "db.sqlite");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("pnpm db:push 非交互可用", () => {
  it("package.json 的 db:push 经 scripts/db-push.mjs，而不是裸 drizzle-kit push", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    // 裸 `drizzle-kit push` 在无 TTY 上「报错 + exit 0 + 留空库」，是本条缺陷的形态。
    expect(pkg.scripts["db:push"]).toBe("node scripts/db-push.mjs");
    expect(pkg.scripts["db:push"]).not.toContain("drizzle-kit");
  });

  it("以 --force 运行 drizzle-kit，且判定依据不是它的退出码", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-push.mjs"),
      "utf8",
    );
    const core = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-push-core.mjs"),
      "utf8",
    );
    /* `--force` 与「命令起没起来 / 跑完落没落地」的判据自 2026-09-20 起收在
     * db-push-core.mjs：`pnpm db:push`（force: true）与启动链路的按需同步
     * （force: false）共用它 —— 两处各判一次必然分叉。 */
    expect(core).toContain('"--force"');
    expect(src).toContain("force: true");
    expect(src).toContain("countUserTables");
    // 判定依据必须是「库里到底有什么」，不能是 drizzle-kit 的退出码
    //（无 TTY 上正是「报错但 exit 0」）。用例用「退出码被显式忽略」的写法钉住这条。
    expect(src).toContain("刻意不看");
    expect(src).not.toMatch(/result\.status\s*===/);
  });

  it("无 TTY 真跑：库文件建不出来时非零退出，而不是留个空库当成功", () => {
    // 指向一个不存在的目录 → drizzle-kit 建不了库，脚本必须失败退出。
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "db-push.mjs")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: `file:${path.join(tmp, "no-such-dir", "db.sqlite")}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    expect(
      result.status,
      "建不出库时必须非零退出（旧实现此处 exit 0）",
    ).not.toBe(0);
    expect(result.stderr).toContain("db:push");
  }, 150_000);

  it("认不出的旗标 ⇒ 非零退出，且**一个字节都没往库里写**（ISSUE #1956）", () => {
    /* 立案现场：这个入口不解析 argv，于是 `node scripts/db-push.mjs --dry-run`
     * 被当成「没有参数的那次调用」照跑 —— 而它默认动的是 `push --force`（真写库、
     * 自动批准会丢数据的语句）。实测那一跑落了库，只因为那批里唯一的 DROP 恰好
     * 打在一张 0 行的表上才没造成损失；方向不该由「恰好表是空的」来兜。
     * 破坏性入口遇到不认识的旗标，唯一不猜的答复是不作动。 */
    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "db-push.mjs"), "--dry-run"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      },
    );
    expect(result.status, "未知参数必须退非零").not.toBe(0);
    expect(result.stderr).toContain("不接受参数");
    // 说清它默认动的是什么，并给出「要一份不写库的清单」该跑哪一条。
    expect(result.stderr).toContain("drizzle-kit push --force");
    expect(result.stderr).toContain("pnpm exec drizzle-kit push");
    /* 真正的那一条判据：库没被建出来。上面那几条话术漂了也会被这条抓住 ——
     * 「打印了拒绝的话」与「没动库」是两件事，这里要的是后者。 */
    expect(fs.existsSync(dbFile), "拒绝参数那一跑不许留下库文件").toBe(false);
  }, 70_000);
});

describe("db:push 的空转档：库已经是这一版 schema 建的就不再起 drizzle", () => {
  /**
   * 平台侧每条 PR 都会跑 `同步数据库表结构`，而绝大多数 PR 一行 schema 都没碰 ——
   * 那一趟 drizzle 只会回一句 `No changes detected`，却要十几秒（CI 节点上更久）。
   *
   * 判据收在 `probeSchemaFresh()`（只读、毫秒级），两种形态必须都是**照跑**：
   *   · 指纹对不上 ⇒ 不知道要不要改，交给 drizzle 说；
   *   · 判据失效（库不在 / 读不到指纹 / 读不到 schema 源）⇒ 「拿不到结论」不是
   *     「已经一致」，不许据此跳过。
   * 用例真造 sqlite 文件来驱动它，不 mock。
   */
  it("库里登记的指纹与源码一致 ⇒ synced（空转档的判据）", async () => {
    const state = await import("../scripts/db-schema-state.mjs");
    const url = `file:${dbFile}`;
    /* 造一份「schema 源目录」：指纹算的是那份目录里 .ts 的内容哈希，与仓库
     * 自己的 src/server/db 无关，所以这里能用最小夹具把两侧对齐。 */
    const schemaDir = path.join(tmp, "src", "server", "db");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(
      path.join(schemaDir, "schema.ts"),
      "export const t = 1;\n",
    );
    createSchema(dbFile);

    /* 表在、但库里从没登记过指纹（\`PRAGMA user_version\` 读出来是 0）⇒ 判据
     * 失效那一档：没有基线就不构成「库落后了」的结论，所以不跳。 */
    expect(state.probeSchemaFresh(tmp, url).state).toBe("unknown");
    const fingerprint = state.schemaFingerprint(tmp);
    expect(fingerprint).not.toBeNull();
    state.writeSchemaFingerprint(tmp, url, fingerprint!);
    expect(state.probeSchemaFresh(tmp, url).state).toBe("synced");

    // 指纹对不上 ⇒ outdated（照跑，由 drizzle 说要不要改）
    state.writeSchemaFingerprint(tmp, url, fingerprint! + 1);
    expect(state.probeSchemaFresh(tmp, url).state).toBe("outdated");
  });

  it("库不在 / 空库 / 读不到 schema 源 ⇒ 都是 unknown（不据此跳过）", async () => {
    const state = await import("../scripts/db-schema-state.mjs");
    const url = `file:${dbFile}`;
    // 库文件都不在
    expect(state.probeSchemaFresh(tmp, url).state).toBe("unknown");
    // 库在但一张表都没有（等价于「从没建过」）
    fs.writeFileSync(dbFile, "");
    expect(state.probeSchemaFresh(tmp, url).state).toBe("unknown");
    // 表在、库里有指纹，但读不到 schema 源
    createSchema(dbFile);
    state.writeSchemaFingerprint(tmp, url, 12345);
    expect(state.probeSchemaFresh(tmp, url).state).toBe("unknown");
  });

  it("db-push 的入口用的是共享判据（不是在本文件里另判一次指纹）", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-push.mjs"),
      "utf8",
    );
    expect(src).toContain("probeSchemaFresh");
    expect(src).toContain('fresh.state === "synced"');
    // 判据失效时不许跳：只认 "synced" 这一档（写成 `!== "outdated"` 会把 unknown 也放过）。
    expect(src).not.toMatch(/fresh\.state\s*!==\s*"outdated"/);
  });
});

describe("探测判据跨实现同源", () => {
  it("scripts/db-schema-state.mjs 与 src/lib/db-schema-ready.ts 认同一张哨兵表", async () => {
    const mjs = await import("../scripts/db-schema-state.mjs");
    const ts = await import("../src/lib/db-schema-ready");
    const tsSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "db-schema-ready.ts"),
      "utf8",
    );
    // TS 侧的哨兵表名从源码里读出来，避免「两边各自改名后互不知情」。
    const m = /const SENTINEL_TABLE = "([^"]+)"/.exec(tsSrc);
    expect(m, "TS 侧必须保留单一定义的 SENTINEL_TABLE").toBeTruthy();
    expect((mjs as { SENTINEL_TABLE: string }).SENTINEL_TABLE).toBe(m![1]);
    // 探针名也要对得上，否则「在不在」的语义无从对照。
    expect(typeof (ts as { probeSchemaSync: unknown }).probeSchemaSync).toBe(
      "function",
    );
  });

  it("同一批真实库状态下，两份实现给出同一结论", async () => {
    const mjs = await import("../scripts/db-schema-state.mjs");
    const ts = await import("../src/lib/db-schema-ready");

    // 状态一：库文件不存在
    expect(mjs.probeSchemaSync(tmp, `file:${dbFile}`)).toBe("unknown");
    expect(ts.probeSchemaSync(`file:${dbFile}`)).toBe("unknown");

    // 状态二：库存在但哨兵表没建
    fs.writeFileSync(dbFile, "");
    expect(mjs.probeSchemaSync(tmp, `file:${dbFile}`)).toBe("missing");
    expect(ts.probeSchemaSync(`file:${dbFile}`)).toBe("missing");

    // 状态三：表建好了（不能把「永远 missing」当成修好了）
    createSchema(dbFile);
    expect(mjs.probeSchemaSync(tmp, `file:${dbFile}`)).toBe("ready");
    expect(ts.probeSchemaSync(`file:${dbFile}`)).toBe("ready");
  });
});

describe("构建期缺 DATABASE_URL 不得把构建打死", () => {
  /**
   * CI 的 Build 步骤跑的是 `SKIP_ENV_VALIDATION=1 pnpm build`，**不注入
   * `DATABASE_URL`**：`env.js` 跳过校验后 `env.DATABASE_URL` 是 `undefined`，
   * 于是 `src/server/db.ts::resolveDbPath` 里的 `url.startsWith(...)` 抛
   * `Cannot read properties of undefined` —— 而 `db.ts` 会被每条路由的模块图
   * 拉到，build 死在 `Collecting page data` 阶段，报错行号落在与库无关的路由上
   * （实测：`/api/debug/source`、`/api/logs/history`）。这与 ISSUE #489 的
   * 「干净检出上 `pnpm build` 必挂」同源、且是同一族里**之前没被发现的一档**。
   *
   * 契约：模块级就绪判断不依赖 env 校验是否开启 —— 缺值时退到与 drizzle-kit
   * 同一锚点的默认库文件，把「表可能还没建」交给运行期的可读出口
   * （`/api/health` 的 503 + `db: empty`）而不是构建期崩溃。
   */
  it("resolveDbPath 的判据对缺值/空值都成立（源码级，避免真起 next build）", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "server", "db.ts"),
      "utf8",
    );
    // 不得只写 `url.startsWith` —— 必须先兜住 undefined/"" 的输入形态。
    expect(
      src.includes("const value = url || DEFAULT_DB_FILE;"),
      "resolveDbPath 必须先兜住 undefined / 空串再 startsWith",
    ).toBe(true);
    // 该模块在构建期模块图上、且会被 code frame 渲染，必须保持纯 ASCII
    //（否则下一个踩中的偏移会把 next build 用一个指不到原因的 Rust panic 打死）。
    const nonAscii = [...src].filter((c) => c.charCodeAt(0) > 127).length;
    expect(
      nonAscii,
      "src/server/db.ts 必须保持纯 ASCII（AGENTS 硬规则 15）",
    ).toBe(0);
  });

  it("db-push 与 db.ts 认同一套默认库文件锚点", () => {
    const pushSrc = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-push.mjs"),
      "utf8",
    );
    const dbSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "server", "db.ts"),
      "utf8",
    );
    /* 默认锚点（`file:./db.sqlite`）的**唯一实现**在 `db-schema-state.mjs` 的
     * `resolveSqlitePath` —— `db-push.mjs` 与 `db-migrate.mjs` 都 import 它。
     * 本用例此前断言的是「`db-push.mjs` 的源码里含这个字面量」，那是在**钉住
     * 实现所在的位置**而不是意图：锚点一经收口（ISSUE #1624 顺手收掉了一份
     * 逐字重复的 `resolveDbPath`），这条就红了 —— 而两处其实仍然认同一个锚点。
     * 改成按意图断言三件：① 共享实现里那份字面量在；② 两个入口都 import 它；
     * ③ TS 侧那份默认值逐字相同。 */
    const stateSrc = fs.readFileSync(
      path.join(process.cwd(), "scripts", "db-schema-state.mjs"),
      "utf8",
    );
    expect(stateSrc).toContain('"file:./db.sqlite"');
    expect(pushSrc).toContain("resolveSqlitePath");
    // db-push 自己**不该**再抄一份默认值（那正是 #1624 收掉的那份重复）。
    expect(pushSrc).not.toContain('"file:./db.sqlite"');
    expect(dbSrc).toContain('"./db.sqlite"');
  });
});
