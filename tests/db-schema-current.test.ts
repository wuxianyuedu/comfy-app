/**
 * 启动链路的 schema 自检（`scripts/db-schema-state.mjs::ensureSchemaCurrent`）。
 *
 * 要钉住的是「拉了含 schema 变更的代码之后**不必记得**跑 `pnpm db:push`」这件事
 * 的三条出口 —— 而它们的判据全都反直觉，靠人读代码看不出对错：
 *
 *   1. 指纹一致 → 毫秒级通过，**不许起 drizzle**（每起一轮约十几秒）；
 *   2. 指纹不一致 + 待执行的语句全是「加表 / 加索引 / 加列」→ 自动应用；
 *   3. 指纹不一致 + 含「删列 / 重建表」→ **不许自动应用**，交人工。
 *
 * 第 3 条是这次的核心：`drizzle.config.ts` 开着 `strict: true`，而无 TTY 环境里
 * 它「列出语句 → 要求确认 → 原地退出、库不动」。于是那一次输出恰好是一份
 * dry-run，白名单判据就建在它上面（判据的失败方向必须是「不自动应用」——
 * drizzle 换了输出格式最多让用户多跑一次命令，不会让我们替他把列删了）。
 *
 * `push` 一律注入 stub：这里要验的是**分类与分支**，真实 drizzle 的 diff 行为
 * 另有 `tests/db-push-noninteractive.test.ts` 与手测覆盖（跑一次十几秒，
 * 放进单测等于每次 `pnpm test` 都多等半分钟）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();

let tmp: string;
let dbFile: string;
let databaseUrl: string;

type PushResult = {
  converged: boolean;
  alreadyCurrent: boolean;
  invocationFailed: boolean;
  blockedByTty: boolean;
  error: Error | null;
  firstOutput: string;
  finalOutput: string;
};

/** drizzle-kit 被 TTY 挡下时的真实输出形态（含它接在后面的报错堆栈）。 */
const DRY_RUN_OUTPUT = `No config path provided, using default 'drizzle.config.ts'
Reading config file 'drizzle.config.ts'
[⣷] Pulling schema from database...
[✓] Pulling schema from database...

 Warning  You are about to execute current statements:

ALTER TABLE \`user\` ADD \`color\` text;

Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
    at render10 (/x/node_modules/drizzle-kit/bin.cjs:1450:31)
    at sqlitePush (/x/node_modules/drizzle-kit/bin.cjs:82817:70)
`;

const NO_CHANGES_OUTPUT = `[✓] Pulling schema from database...

[i] No changes detected
`;

function pushStub(options: {
  dryOutput: string;
  applyChanges?: () => void;
}): (root: string, opts?: Record<string, unknown>) => PushResult {
  return (_root, opts) => {
    if (opts?.force !== true) {
      /* 不带 --force 的那次 = dry-run：被 TTY 挡下、库不动。 */
      return {
        converged: /No changes detected/i.test(options.dryOutput),
        alreadyCurrent: false,
        invocationFailed: false,
        blockedByTty: !/No changes detected/i.test(options.dryOutput),
        error: null,
        firstOutput: options.dryOutput,
        finalOutput: options.dryOutput,
      };
    }
    options.applyChanges?.();
    return {
      converged: true,
      alreadyCurrent: false,
      invocationFailed: false,
      blockedByTty: false,
      error: null,
      firstOutput: "[✓] Changes applied\n",
      finalOutput: NO_CHANGES_OUTPUT,
    };
  };
}

function makeDb(file: string, extraSql = ""): void {
  execFileSync(
    process.execPath,
    [
      "-e",
      `const { DatabaseSync } = require("node:sqlite");
       const db = new DatabaseSync(${JSON.stringify(file)});
       db.exec("CREATE TABLE task (id TEXT PRIMARY KEY, status TEXT)");
       db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
       ${extraSql}
       db.close();`,
    ],
    { stdio: "pipe" },
  );
}

function columnsOf(file: string, table: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function readUserVersion(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Number(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "schema-current-"));
  dbFile = path.join(tmp, "db.sqlite");
  databaseUrl = `file:${dbFile}`;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("pendingStatements —— 只认 SQL 行", () => {
  it("从 dry-run 输出里取出待执行语句，不把报错堆栈当成语句", async () => {
    const { pendingStatements } = await import("../scripts/db-push-core.mjs");
    expect(pendingStatements(DRY_RUN_OUTPUT)).toEqual([
      "ALTER TABLE `user` ADD `color` text;",
    ]);
  });

  it("没有语句列表时给空数组（调用方据此判「不认识 → 交人工」）", async () => {
    const { pendingStatements } = await import("../scripts/db-push-core.mjs");
    expect(pendingStatements(NO_CHANGES_OUTPUT)).toEqual([]);
    expect(pendingStatements("")).toEqual([]);
  });
});

describe("canAutoApply —— 白名单", () => {
  it("加表 / 加索引 / 加列可以自动应用", async () => {
    const { canAutoApply } = await import("../scripts/db-push-core.mjs");
    expect(
      canAutoApply([
        "ALTER TABLE `user` ADD `color` text;",
        "CREATE TABLE `tag` (`id` text PRIMARY KEY);",
        "CREATE UNIQUE INDEX `tag_id_uniq` ON `tag` (`id`);",
      ]),
    ).toBe(true);
  });

  it("删列 / 重建表不在白名单里（判据的失败方向必须是「不自动应用」）", async () => {
    const { canAutoApply, riskyStatements } = await import(
      "../scripts/db-push-core.mjs"
    );
    const drop = [
      "ALTER TABLE `user` DROP COLUMN `color`;",
      "DROP TABLE `task`;",
    ];
    expect(canAutoApply(drop)).toBe(false);
    expect(riskyStatements(drop)).toEqual(drop);
    /* 混在一起也要挡住：只要有一条危险语句，整批交人工。 */
    expect(
      canAutoApply(["ALTER TABLE `user` ADD `a` text;", ...drop.slice(0, 1)]),
    ).toBe(false);
  });

  it("空列表不算「可以自动应用」（不认识就交人工）", async () => {
    const { canAutoApply } = await import("../scripts/db-push-core.mjs");
    expect(canAutoApply([])).toBe(false);
  });
});

describe("ensureSchemaCurrent —— 三条出口", () => {
  it("库/哨兵表都没有时判 missing", async () => {
    const { ensureSchemaCurrent } = await import("../scripts/db-schema-state.mjs");
    expect(ensureSchemaCurrent(root, { databaseUrl }).state).toBe("missing");

    fs.writeFileSync(dbFile, "");
    expect(ensureSchemaCurrent(root, { databaseUrl }).state).toBe("missing");
  });

  it("指纹一致时直接 ready，**不起 drizzle**", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } = await import(
      "../scripts/db-schema-state.mjs"
    );
    makeDb(dbFile);
    const fingerprint = schemaFingerprint(root);
    expect(fingerprint, "项目根的 schema 源必须可读").not.toBeNull();
    execFileSync(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(${JSON.stringify(dbFile)});
         db.exec("PRAGMA user_version = ${fingerprint}");
         db.close();`,
      ],
      { stdio: "pipe" },
    );

    const push = vi.fn();
    expect(ensureSchemaCurrent(root, { databaseUrl, push }).state).toBe("ready");
    expect(push, "指纹一致时不该有任何 drizzle 调用").not.toHaveBeenCalled();
  });

  it("指纹缺登记、但库其实已经一致：登记指纹并判 ready（不打扰用户）", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } = await import(
      "../scripts/db-schema-state.mjs"
    );
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({ dryOutput: NO_CHANGES_OUTPUT }),
    });
    expect(state.state).toBe("ready");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("安全变更（加列）自动应用，并把指纹登记上", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } = await import(
      "../scripts/db-schema-state.mjs"
    );
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({
        dryOutput: DRY_RUN_OUTPUT,
        applyChanges: () => {
          execFileSync(
            process.execPath,
            [
              "-e",
              `const { DatabaseSync } = require("node:sqlite");
               const db = new DatabaseSync(${JSON.stringify(dbFile)});
               db.exec("ALTER TABLE user ADD COLUMN color text");
               db.close();`,
            ],
            { stdio: "pipe" },
          );
        },
      }),
    });
    expect(state.state).toBe("synced");
    expect(columnsOf(dbFile, "user")).toContain("color");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("危险变更（删列）不自动应用：判 stale，且**库里的列还在**", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } = await import(
      "../scripts/db-schema-state.mjs"
    );
    makeDb(dbFile, "db.exec('ALTER TABLE user ADD COLUMN color text')");
    const applyChanges = vi.fn();
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({
        dryOutput: DRY_RUN_OUTPUT.replace(
          "ADD `color` text;",
          "DROP COLUMN `color`;",
        ),
        applyChanges,
      }),
    });
    expect(state.state).toBe("stale");
    expect(state.detail, "要讲清是「会丢数据」这一类").toContain("会丢数据");
    expect(applyChanges, "危险变更不许走到应用那一步").not.toHaveBeenCalled();
    /* 这条是这次改动真正要保住的东西：数据没被启动链路悄悄删掉。 */
    expect(columnsOf(dbFile, "user")).toContain("color");
    expect(readUserVersion(dbFile), "没成功就不许登记指纹").not.toBe(
      schemaFingerprint(root),
    );
  });

  it("drizzle 说「已应用」但库结构没变时判 stale（不许错写指纹）", async () => {
    const { ensureSchemaCurrent } = await import("../scripts/db-schema-state.mjs");
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({ dryOutput: DRY_RUN_OUTPUT }),
    });
    expect(state.state).toBe("stale");
    expect(state.detail).toContain("结构没有变化");
  });
});

describe("schemaNotice —— 只在该说话时说话", () => {
  it("ready 不打印任何东西", async () => {
    const { schemaNotice } = await import("../scripts/db-schema-state.mjs");
    expect(schemaNotice({ state: "ready" })).toBeNull();
  });

  it("stale 要把「跑哪条命令」讲清楚（启动链路不替用户做丢数据的决定）", async () => {
    const { schemaNotice } = await import("../scripts/db-schema-state.mjs");
    const notice = schemaNotice({ state: "stale", detail: "含「会丢数据」的语句" });
    expect(notice?.level).toBe("warn");
    expect(notice?.lines.join("\n")).toContain("pnpm db:push");
  });
});
