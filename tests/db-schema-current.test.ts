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

/**
 * **空库**上 `drizzle-kit push`（不带 `--force`）的真实输出形态（实测于本机
 * drizzle-kit 0.31.10）：先把待执行的语句列出来，再被无 TTY 挡下、库不动。
 *
 * 这一档是 ISSUE 的实际现场：库文件在、一张表都没有（`drizzle-kit` 在无 TTY 上
 * 留下的就是 0 字节文件），过去 `ensureSchemaCurrent` 直接 `return missing`，
 * 于是 `/api/health` 恒返回 503、启动器空等满 180s 回收整棵树。现在它必须能被
 * 自动建起来 —— 首次建表只会产生下面这两类语句，全在自动应用的白名单里。
 */
const FRESH_DB_DRY_RUN_OUTPUT = `No config path provided, using default 'drizzle.config.ts'
Reading config file 'drizzle.config.ts'
[⣷] Pulling schema from database...
[✓] Pulling schema from database...

 Warning  You are about to execute current statements:

CREATE TABLE \`task\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`status\` text NOT NULL
);

CREATE INDEX \`task_status_idx\` ON \`task\` (\`status\`);

Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
    at render10 (/x/node_modules/drizzle-kit/bin.cjs:1450:31)
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
    const { canAutoApply, riskyStatements } =
      await import("../scripts/db-push-core.mjs");
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

  it("describeRiskyChanges 把危险语句翻成「哪个表哪列会丢」，完整列出", async () => {
    const { describeRiskyChanges } =
      await import("../scripts/db-push-core.mjs");
    expect(
      describeRiskyChanges([
        "ALTER TABLE `user` DROP COLUMN `color`;",
        "DROP TABLE `task`;",
        /* SQLite 的重建表三件套：建 __new、搬数据、删旧表再改名。 */
        "CREATE TABLE `__new_workflowTemplate` (`id` text PRIMARY KEY);",
        "INSERT INTO `__new_workflowTemplate`(`id`) SELECT `id` FROM `workflowTemplate`;",
        "DROP TABLE `workflowTemplate`;",
        "ALTER TABLE `__new_workflowTemplate` RENAME TO `workflowTemplate`;",
        /* 白名单内的语句不描述（它不丢数据）。 */
        "ALTER TABLE `user` ADD `a` text;",
      ]),
    ).toEqual([
      "user.color（删列，该列的数据会丢）",
      "task（删表，整张表的数据会丢）",
      "workflowTemplate（重建表，对不上的列的数据会丢）",
    ]);
  });

  it("describeRiskyChanges：认不出的语句原样列出（描述不出来 ≠ 不列出来）", async () => {
    const { describeRiskyChanges } =
      await import("../scripts/db-push-core.mjs");
    expect(describeRiskyChanges(["UPDATE `user` SET `a` = 1;"])).toEqual([
      "「UPDATE `user` SET `a` = 1」",
    ]);
  });

  it("空列表不算「可以自动应用」（不认识就交人工）", async () => {
    const { canAutoApply } = await import("../scripts/db-push-core.mjs");
    expect(canAutoApply([])).toBe(false);
  });
});

describe("ensureSchemaCurrent —— 空库（一张表都没有）", () => {
  /** 建出哨兵表，模拟「drizzle 这轮真的把表建起来了」。 */
  function createSentinelTable(): void {
    execFileSync(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(${JSON.stringify(dbFile)});
         db.exec("CREATE TABLE task (id TEXT PRIMARY KEY, status TEXT)");
         db.close();`,
      ],
      { stdio: "pipe" },
    );
  }

  it("库文件都不存在时也自动建表（不再交给用户 / 不再等超时）", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
    expect(fs.existsSync(dbFile)).toBe(false);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({
        dryOutput: FRESH_DB_DRY_RUN_OUTPUT,
        applyChanges: createSentinelTable,
      }),
    });
    expect(state.state).toBe("synced");
    expect(
      readUserVersion(dbFile),
      "建完必须登记指纹，否则每次启动都要再跑一轮 drizzle",
    ).toBe(schemaFingerprint(root));
  });

  it("0 字节空库（drizzle-kit 在无 TTY 上留下的形态）同样自动建起来", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
    fs.writeFileSync(dbFile, "");
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({
        dryOutput: FRESH_DB_DRY_RUN_OUTPUT,
        applyChanges: createSentinelTable,
      }),
    });
    expect(state.state).toBe("synced");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("自动建表没落地（报了 applied 但库没变）→ missing，且不登记指纹", async () => {
    const { ensureSchemaCurrent } =
      await import("../scripts/db-schema-state.mjs");
    fs.writeFileSync(dbFile, "");
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({ dryOutput: FRESH_DB_DRY_RUN_OUTPUT }),
    });
    /* 表从来没建起来 —— 说法必须是 missing（「跑 pnpm db:push」），不是 stale。 */
    expect(state.state).toBe("missing");
    expect(readUserVersion(dbFile)).toBe(0);
  });

  it("空库 + 认不出待执行语句 → missing，绝不猜着执行", async () => {
    const { ensureSchemaCurrent } =
      await import("../scripts/db-schema-state.mjs");
    fs.writeFileSync(dbFile, "");
    const applyChanges = vi.fn();
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({
        dryOutput: "Error: 什么都认不出来\n",
        applyChanges,
      }),
    });
    expect(state.state).toBe("missing");
    expect(state.detail).toContain("没能从 drizzle 的输出里认出");
    expect(applyChanges, "认不出就交人工，不许盲执行").not.toHaveBeenCalled();
  });
});

describe("ensureSchemaCurrent —— 三条出口", () => {
  it("指纹一致时直接 ready，**不起 drizzle**", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
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
    expect(ensureSchemaCurrent(root, { databaseUrl, push }).state).toBe(
      "ready",
    );
    expect(push, "指纹一致时不该有任何 drizzle 调用").not.toHaveBeenCalled();
  });

  it("指纹缺登记、但库其实已经一致：登记指纹并判 ready（不打扰用户）", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({ dryOutput: NO_CHANGES_OUTPUT }),
    });
    expect(state.state).toBe("ready");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("安全变更（加列）自动应用，并把指纹登记上", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
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
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
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
    /* detail 要把「哪个表哪列会丢」完整列出（toast / 确认弹窗共用这一句）。 */
    expect(state.detail).toContain("user.color（删列，该列的数据会丢）");
    expect(applyChanges, "危险变更不许走到应用那一步").not.toHaveBeenCalled();
    /* 这条是这次改动真正要保住的东西：数据没被启动链路悄悄删掉。 */
    expect(columnsOf(dbFile, "user")).toContain("color");
    expect(readUserVersion(dbFile), "没成功就不许登记指纹").not.toBe(
      schemaFingerprint(root),
    );
  });

  it("drizzle 说「已应用」但库结构没变时判 stale（不许错写指纹）", async () => {
    const { ensureSchemaCurrent } =
      await import("../scripts/db-schema-state.mjs");
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      push: pushStub({ dryOutput: DRY_RUN_OUTPUT }),
    });
    expect(state.state).toBe("stale");
    expect(state.detail).toContain("结构没有变化");
  });
});

describe("ensureSchemaCurrent —— force 路径（状态栏「立即同步」）", () => {
  /**
   * force 路径的 stub：**不该**有 dry-run（那次不带 --force 的调用是启动链路
   * 的判据来源，force 意味着用户已在确认弹窗里知情），只接受一次 --force。
   */
  function forceStub(options: {
    applyChanges?: () => void;
    /** drizzle 说 No changes detected（并发的那份同步先做完了）。 */
    noChanges?: boolean;
  }): (root: string, opts?: Record<string, unknown>) => PushResult {
    return (_root, opts) => {
      if (opts?.force !== true) {
        throw new Error("force 路径不应发起 dry-run");
      }
      if (options.noChanges) {
        return {
          converged: true,
          alreadyCurrent: true,
          invocationFailed: false,
          blockedByTty: false,
          error: null,
          firstOutput: NO_CHANGES_OUTPUT,
          finalOutput: NO_CHANGES_OUTPUT,
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

  it("用户确认后，含丢数据的变更也按 --force 应用并登记指纹", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
    /* 库里多出一列（schema 已删掉它 → dry-run 判 stale 的那批语句），force
     * 这一路必须真的把它删掉 —— 这是用户在弹窗里确认过的那件事。 */
    makeDb(dbFile, "db.exec('ALTER TABLE user ADD COLUMN legacy text')");
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      force: true,
      push: forceStub({
        applyChanges: () => {
          execFileSync(
            process.execPath,
            [
              "-e",
              `const { DatabaseSync } = require("node:sqlite");
               const db = new DatabaseSync(${JSON.stringify(dbFile)});
               db.exec("ALTER TABLE user DROP COLUMN legacy");
               db.close();`,
            ],
            { stdio: "pipe" },
          );
        },
      }),
    });
    expect(state.state).toBe("synced");
    expect(columnsOf(dbFile, "user")).not.toContain("legacy");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("库已一致（点按钮时并发的同步先做完了）→ ready，不误报失败", async () => {
    const { ensureSchemaCurrent, schemaFingerprint } =
      await import("../scripts/db-schema-state.mjs");
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      force: true,
      push: forceStub({ noChanges: true }),
    });
    expect(state.state).toBe("ready");
    expect(readUserVersion(dbFile)).toBe(schemaFingerprint(root));
  });

  it("报了 applied 但库结构没动、指纹也没登记 → stale（不许错写「已同步」）", async () => {
    const { ensureSchemaCurrent } =
      await import("../scripts/db-schema-state.mjs");
    makeDb(dbFile);
    const state = ensureSchemaCurrent(root, {
      databaseUrl,
      force: true,
      push: forceStub({}),
    });
    expect(state.state).toBe("stale");
    expect(state.detail).toContain("结构没有变化");
    expect(readUserVersion(dbFile), "没成功就不许登记指纹").toBe(0);
  });
});

describe("schemaNotice —— 只在该说话时说话", () => {
  it("ready 不打印任何东西", async () => {
    const { schemaNotice } = await import("../scripts/db-schema-state.mjs");
    expect(schemaNotice({ state: "ready" })).toBeNull();
  });

  it("stale 要把「跑哪条命令」讲清楚（启动链路不替用户做丢数据的决定）", async () => {
    const { schemaNotice } = await import("../scripts/db-schema-state.mjs");
    const notice = schemaNotice({
      state: "stale",
      detail: "含「会丢数据」的语句",
    });
    expect(notice?.level).toBe("warn");
    expect(notice?.lines.join("\n")).toContain("pnpm db:push");
  });

  it("missing 要说清是「自动建表没成功」（不是「你忘了建库」）", async () => {
    const { schemaNotice } = await import("../scripts/db-schema-state.mjs");
    const notice = schemaNotice({ state: "missing" });
    expect(notice?.level).toBe("warn");
    const text = notice?.lines.join("\n") ?? "";
    expect(text).toContain("pnpm db:push");
    expect(text, "建表是启动链路自己试过的，别把责任推给用户").toContain(
      "自动建表",
    );
  });
});
