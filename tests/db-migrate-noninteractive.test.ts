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
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSqlitePath } from "../scripts/db-schema-state.mjs";
import { acquireRepoDrizzle } from "./helpers/repo-drizzle-lock";

let tmp: string;
let dbFile: string;
/** 真仓库里的迁移目录；用例期间可能被临时挪开。 */
const REAL_DRIZZLE = path.join(process.cwd(), "drizzle");
let moved: string | null = null;
/** 本条用例持有真 `drizzle/` 的独占锁的释放函数（见 `tests/helpers/repo-drizzle-lock.ts`）。 */
let releaseDrizzle: (() => void) | null = null;

/** 把真 `drizzle/` 挪到一边（返回备份路径）；已经在一边时返回 null。 */
function hideMigrations(): string | null {
  if (!fs.existsSync(REAL_DRIZZLE)) {
    return null;
  }
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

/**
 * 整个文件持有真 `drizzle/` 的独占锁（`tests/helpers/repo-drizzle-lock.ts`）。
 *
 * 本文件判「前提不成立」的唯一造法就是**把真迁移目录挪开**，而
 * `tests/db-migrate-equivalence.test.ts`（两次真起 `db-migrate`）与下面「绝对库真的落表」
 * 那一档都**要靠它在场**。两个文件在不同 worker 里并行时，实测红法是：
 * 等价性那份**一条断言都没红**、整个文件在 `beforeAll` 里挂，话术写着「没有可应用的迁移」。
 * 锁按文件粒度取（不是每条用例一次）：等待只可能发生一次，而 `hookTimeout` 是 45s，
 * 对面那份文件实测要 ~80s —— 按用例取锁会先把钩子自己顶穿。
 */
beforeAll(async () => {
  releaseDrizzle = await acquireRepoDrizzle("db-migrate-noninteractive");
}, 480_000);

afterAll(() => {
  releaseDrizzle?.();
  releaseDrizzle = null;
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-migrate-"));
  dbFile = path.join(tmp, "db.sqlite");
});

afterEach(() => {
  restoreMigrations();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 在真仓库里跑迁移入口（`stdio` 全 pipe：无 TTY，正是要复现的环境）。 */
function runMigrate(databaseUrl = `file:${dbFile}`, extraArgs: Array<string> = []) {
  return spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "db-migrate.mjs"), ...extraArgs],
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
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    // 裸 `drizzle-kit migrate` 在前提不成立时「先建库、再退 1、留空壳」（实测）。
    expect(pkg.scripts["db:migrate"]).toBe("node scripts/db-migrate.mjs");
    expect(pkg.scripts["db:migrate"]).not.toContain("drizzle-kit");
  });

  it("判定依据是库里的真事实（表数 + 账本），不是 drizzle-kit 的退出码", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "db-migrate.mjs"), "utf8");
    expect(src).toContain("countUserTables");
    expect(src).toContain("appliedMigrations");
    // 退出码在这条链路上不可信（实测：先建 0 字节库、再退 1），源码里必须写明。
    expect(src).toContain("不看退出码");
  });

  it("前置判决按 .sql 筛，而不是「目录在不在」", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "db-migrate.mjs"), "utf8");
    // 「目录在、但一份迁移都没有」与「目录不在」是同样建不出库的现场，
    // 判据只认前者的话会漏过去。
    expect(src).toContain('.endsWith(".sql")');
    expect(src).toContain("files.length === 0");
  });
});

/**
 * 参数契约（ISSUE #2096）：认不出的旗标**不许**被吞掉之后照旧落库。
 *
 * 立案实测（修之前）：这个入口一句 `argv` 都不读，于是
 * `node scripts/db-migrate.mjs --dry-run` 被当成「没有参数的那一次调用」照跑 ——
 * 临时库里建出 23 张表、`__drizzle_migrations` 记上 1/1，**退出码 0**。
 *
 * ⚠️ 这一档刻意**不挪开**真 `drizzle/`（与上面那档相反）：判的正是
 * 「迁移文件在场、写库那条路是活的」那一形 —— 拿「前提不成立」的早退来当
 * 「它没写库」的证据，会把这条缺陷读成不存在。
 *
 * 断言的重心是**库里的事实**（库文件没被建出来），不是话术里有没有那两个字：
 * 「打印了拒绝的话」与「没动库」是两件事，后者才是这条链要的（同
 * `tests/db-push-noninteractive.test.ts` 的 #1956 那一条）。
 */
describe("参数契约：未知旗标拦下，且一个字节都不写", () => {
  it("`--dry-run` ⇒ 非零退出，库文件**根本没被创建**", () => {
    const r = runMigrate(`file:${dbFile}`, ["--dry-run"]);
    expect(r.status, "认不出的参数必须退非零").not.toBe(0);
    expect(r.stderr).toContain("不接受参数");
    // 话术要把「它默认动的是什么」说出来：只说「参数不对」等于让人再猜一轮。
    expect(r.stderr).toContain("drizzle-kit migrate");
    expect(r.stderr).toContain("__drizzle_migrations");
    expect(
      fs.existsSync(dbFile),
      "拦下那一跑不许留下库文件（这一格的存在意义就是「不作动」）",
    ).toBe(false);
  }, 150_000);

  it("不带参数时**不**被这道守卫拦住（守卫不是「永远退非零」）", () => {
    /* 反向的一半必须有：把守卫写成无条件 fail，上面那条照样绿。
     * 这里只要求「走过 ⓪ 步」—— 真跑会去起 drizzle-kit，所以判的是它**没有**
     * 报「不接受参数」，而不是判它最终红绿（那由库里的事实决定）。 */
    const r = runMigrate(`file:${path.join(tmp, "no-such-dir", "db.sqlite")}`);
    expect(r.stderr).not.toContain("不接受参数");
  }, 150_000);
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

/**
 * 库地址那一档（同一批实测里挖出来的，比「留 0 字节库」更隐蔽）。
 *
 * `drizzle.config.ts` 原先无条件 `.replace(/^file:/, "")`，注释写着「drizzle-kit
 * 需要纯路径」。实测它是**错的**：drizzle-kit@0.31.11 的 sqlite 驱动就是
 * `@libsql/client`（`connectToSQLite` → `createClient` → `expandConfig`），而 libsql
 * 把裸字符串按 URL 解析 —— 绝对 Windows 地址 `C:\...\db.sqlite` 被读成
 * scheme="C:"，当场 `URL_SCHEME_NOT_SUPPORTED`；**并且它报错后仍然 exit 0**
 * （实测两档都 0），于是这条链路上「静默没建表」只由查库复核抓到。
 *
 * 长期没暴露的原因：日常 `.env` 是 `file:./db.sqlite`，剥完是 `./db.sqlite`，
 * 里面没有冒号。而运行期装配的地址（`launcher-core/standalone-runtime-env.mjs`）
 * 与本文件的临时库地址都是**绝对**形式 —— 正是被剥坏的那一档。
 *
 * 三档各判一件事，缺一档就退回原来的形状：
 *   1. 地址形状（与机器无关）：五种 `DATABASE_URL` 形态都不许退化成裸盘符，
 *      且剥完前缀必须落回 `resolveSqlitePath` 说的同一个文件；
 *   2. 真跑：绝对临时库 + 真 `drizzle/` 必须**真的建出表**（修之前这条恒红）；
 *   3. 失败话术：非零那一支要把 drizzle 自己的话带出来，「输出见上」不算原因。
 */
describe("库地址形态：交给 drizzle-kit 的必须是 libsql 认的那一份", () => {
  /** 数一遍临时库里的用户表（读不到就返回 -1，让断言自己说清是哪种缺件）。 */
  function countTables(file: string): number {
    if (!fs.existsSync(file)) {
      return -1;
    }
    const db = new DatabaseSync(file, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'",
        )
        .get();
      return Number(row?.c ?? 0);
    } finally {
      db.close();
    }
  }

  it("五种 DATABASE_URL 形态都不退化成裸盘符，且与 resolveSqlitePath 同一锚点", async () => {
    /* 绝对路径取自本用例自己的临时目录（不是写死的 `C:\`）：这样 POSIX 上同样跑得通，
     * 而盘符那一档要靠**内容里有没有冒号**复现 —— 临时绝对路径在 Windows 上就是
     * `C:\Users\…`，在 Linux 上是 `/tmp/…`，两种都必须被补成带 scheme 的地址。 */
    const abs = dbFile;
    const cases: Array<[string, string]> = [
      ["file:./db.sqlite", path.resolve(process.cwd(), "db.sqlite")],
      ["./db.sqlite", path.resolve(process.cwd(), "db.sqlite")],
      /* 空串这一档不是假想：`SKIP_ENV_VALIDATION=1` 时它就是会出现（`src/server/db.ts`
       * 为此写了 `url || DEFAULT_DB_FILE`，`tests/db-push-noninteractive.test.ts` 里
       * 有那一格的源码级判据）。两侧都必须回到同一个默认库，谁兜不住都会分叉。 */
      ["", path.resolve(process.cwd(), "db.sqlite")],
      [`file:${abs}`, abs],
      [abs, abs],
    ];
    const previous = process.env.DATABASE_URL;
    const problems: Array<string> = [];
    try {
      for (const [value, expectedFile] of cases) {
        process.env.DATABASE_URL = value;
        /* 配置在 **import 时**读环境变量，所以每一档都要重新求值模块，
         * 否则第一档的常量会被 module 缓存带到后面四档去（那是自证式的假绿）。 */
        vi.resetModules();
        /* SAFETY: 类型断言已复核 */
        const imported = (await import("../drizzle.config")) as {
          default?: { dbCredentials?: { url?: string } };
        };
        const url = imported.default?.dbCredentials?.url;
        if (typeof url !== "string" || url === "") {
          problems.push(`DATABASE_URL="${value}" → 配置里拿不到 dbCredentials.url`);
          continue;
        }
        if (!url.startsWith("file:")) {
          problems.push(
            `DATABASE_URL="${value}" → 配置给出 "${url}"：` +
              '裸的盘符/绝对路径会被 libsql 读成 scheme="C:" 并抛 URL_SCHEME_NOT_SUPPORTED' +
              "（而 drizzle-kit 报错后仍然 exit 0）。",
          );
        }
        /* 「同一个库」这件事必须现算，不许两边各自解释：剥掉 scheme 后按项目根/CWD
         * 解析，要落到期望那个文件，也要与 `resolveSqlitePath`（应用与探测那侧的
         * 唯一口径）给出同一个路径。 */
        const fromConfig = path.resolve(
          process.cwd(),
          url.startsWith("file:") ? url.slice("file:".length) : url,
        );
        if (fromConfig !== path.resolve(expectedFile)) {
          problems.push(
            `DATABASE_URL="${value}" → 配置指向 "${fromConfig}"，期望 "${expectedFile}"`,
          );
        }
        const fromResolver = resolveSqlitePath(process.cwd(), value);
        if (fromConfig !== fromResolver) {
          problems.push(
            `DATABASE_URL="${value}" → 两条锚点分叉：配置侧 "${fromConfig}" vs resolveSqlitePath "${fromResolver}"`,
          );
        }
      }
    } finally {
      process.env.DATABASE_URL = previous;
      vi.resetModules();
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("绝对临时库 + 真 drizzle/ → 迁移真的落地（不是「退 0 而库里没有表」）", () => {
    /* 这一条判的是**结果**，不看 drizzle-kit 的退出码（它报错时也退 0）：
     * 修之前 `runMigrate()` 用的是 `file:<绝对临时路径>`，被 config 剥成裸盘符 →
     * 地址被拒 → 表数 0 → 本条红。 */
    const r = runMigrate();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(
      countTables(dbFile),
      `迁移说成功了，但 ${dbFile} 里没有用户表（stdout:\n${r.stdout}\n）`,
    ).toBeGreaterThan(0);
  }, 300_000);

  it("失败话术里带着 drizzle 自己的输出，「输出见上」不是一句可行动的话", () => {
    /* 建不出库那一档：上面那条只判「非零」，在地址被拒的旧形态下它也是非零 ——
     * 于是话术里有没有真原因是**另一件事**，要单独钉。 */
    const r = runMigrate(`file:${path.join(tmp, "no-such-dir", "db.sqlite")}`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("drizzle-kit 的输出");
    const after = r.stderr.slice(r.stderr.indexOf("drizzle-kit 的输出"));
    expect(
      after.split("\n").filter((line) => line.trim().length > 0).length,
      `失败话术里那一段必须是内容而不是一句标题：\n${r.stderr}`,
    ).toBeGreaterThan(1);
  }, 300_000);
});
