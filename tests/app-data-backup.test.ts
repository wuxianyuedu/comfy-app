/**
 * `scripts/app-data-backup.mjs`（本机应用数据的备份 / 恢复 / 导入，ISSUE #3732）的判据。
 * 全部对着「真动了哪个文件」：备份把 `data/` 顶层文件拷进
 * `data/backups/app-data-backup-<时刻>/`；恢复把它们拷回 `data/` 且先存退路；
 * 导入从指定目录认 `db-backup-*.sqlite` 与 `app-data-backup-` 目录，坏的跳过、
 * 同名不覆盖。`process.cwd()` 指到临时目录（与 setting-backup.test.ts 同一口径）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAppDataBackup,
  importBackupFromDir,
  listAppDataBackups,
  listAppDataFiles,
  pruneAppDataBackups,
  restoreAppDataBackup,
} from "../scripts/app-data-backup.mjs";
import { verifyBackupFile } from "../scripts/db-backup-core.mjs";

let root: string;
let realCwd: string;

/** data/ 里放两份应用数据文件（模拟真实内容）。 */
function seedAppData(): void {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "app-settings.json"), '{"theme":"light"}');
  fs.writeFileSync(path.join(root, "data", "llm-secret.key"), "secret-bytes");
}

/** 造一份有数据的真库（与 setting-backup.test.ts 同款）。 */
function seedDb(): void {
  const db = new DatabaseSync(path.join(root, "db.sqlite"));
  try {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.exec("INSERT INTO t (v) VALUES ('seed')");
  } finally {
    db.close();
  }
}

beforeEach(() => {
  realCwd = process.cwd();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "app-data-backup-"));
  process.chdir(root);
  seedAppData();
  seedDb();
});

afterEach(() => {
  process.chdir(realCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("listAppDataFiles", () => {
  it("列出 data/ 顶层文件；backups/ 与子目录不在清单里", () => {
    fs.mkdirSync(path.join(root, "data", "backups"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "backups", "db-backup-1.sqlite"), "x");
    fs.mkdirSync(path.join(root, "data", "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "sub", "nested.txt"), "x");

    const files = listAppDataFiles(root).map((f) => f.name);
    expect(files).toContain("app-settings.json");
    expect(files).toContain("llm-secret.key");
    expect(files).not.toContain("db-backup-1.sqlite");
    expect(files).not.toContain("nested.txt");
  });

  it("data/ 不存在时给空清单（全新安装的合法状态）", () => {
    fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
    expect(listAppDataFiles(root)).toEqual([]);
  });
});

describe("createAppDataBackup", () => {
  it("把 data/ 顶层文件拷进 app-data-backup-<时刻>/，与数据库快照同在 backups/", () => {
    const result = createAppDataBackup(root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.name).toMatch(/^app-data-backup-\d{8}-\d{6}(?:-\d+)?$/);
    const dir = path.join(root, "data", "backups", result.name);
    expect(fs.readFileSync(path.join(dir, "app-settings.json"), "utf8")).toBe('{"theme":"light"}');
    expect(fs.readFileSync(path.join(dir, "llm-secret.key"), "utf8")).toBe("secret-bytes");
  });

  it("data/ 里没有文件时返回 nothing（不是失败）", () => {
    fs.rmSync(path.join(root, "data"), { recursive: true, force: true });
    const result = createAppDataBackup(root);
    expect(result.ok, JSON.stringify(result)).toBe(false);
    if (result.ok) {
      return;
    }
    expect("nothing" in result && result.nothing).toBe(true);
  });

  it("按保留套数轮转：第 4 套出现后最老的一套被删", () => {
    for (let i = 0; i < 4; i += 1) {
      fs.writeFileSync(path.join(root, "data", "app-settings.json"), `{"n":${String(i)}}`);
      const result = createAppDataBackup(root, { now: new Date(Date.now() + i * 60_000) });
      expect(result.ok).toBe(true);
    }
    expect(listAppDataBackups(root)).toHaveLength(3);
  });
});

describe("listAppDataBackups / pruneAppDataBackups", () => {
  it("清单新→旧；轮转删掉超出保留套数的最老一套", () => {
    for (let i = 0; i < 3; i += 1) {
      createAppDataBackup(root, { now: new Date(Date.now() + i * 60_000) });
    }
    const sets = listAppDataBackups(root);
    expect(sets).toHaveLength(3);
    expect(sets[0]!.name >= sets[1]!.name).toBe(true);

    /* 轮转：删掉最老的一套，保留最近 2 套 */
    const removed = pruneAppDataBackups(root, 2);
    expect(removed).toEqual([sets[2]!.name]);
    expect(listAppDataBackups(root)).toHaveLength(2);
  });
});

describe("restoreAppDataBackup", () => {
  it("把备份套里的文件拷回 data/，并先把当前 data/ 存进退路目录", () => {
    const made = createAppDataBackup(root, {});
    expect(made.ok).toBe(true);

    /* 改动当前 data/，再从备份恢复 */
    fs.writeFileSync(path.join(root, "data", "app-settings.json"), '{"theme":"dark"}');
    const result = restoreAppDataBackup(root, "app-data-backup-19700101-000000");
    /* 名字不在清单里 ⇒ 拒绝（fail-closed） */
    expect(result.ok).toBe(false);

    const sets = listAppDataBackups(root);
    const result2 = restoreAppDataBackup(root, sets[0]!.name, {});
    expect(result2.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, "data", "app-settings.json"), "utf8")).toBe(
      '{"theme":"light"}',
    );
    /* 退路目录在 backups/ 里，当前那份没丢 */
    const safetyDirs = fs
      .readdirSync(path.join(root, "data", "backups"))
      .filter((name) => name.startsWith("app-data-pre-restore-"));
    expect(safetyDirs.length).toBeGreaterThan(0);
  });

  it("名字不是备份套 / 目录不存在 ⇒ 拒绝", () => {
    expect(restoreAppDataBackup(root, "not-a-set").ok).toBe(false);
    expect(restoreAppDataBackup(root, "app-data-backup-19700101-000000").ok).toBe(false);
  });
});

describe("importBackupFromDir", () => {
  it("从指定目录导入 db 快照（过 integrity_check）与 app-data 备份套", () => {
    /* 先在「来源目录」里摆一份别的机器的备份 */
    const from = path.join(root, "from-machine");
    fs.mkdirSync(path.join(from, "app-data-backup-20261113-000000"), { recursive: true });
    fs.writeFileSync(path.join(from, "app-data-backup-20261113-000000", "app-settings.json"), "{}");
    const db = new DatabaseSync(path.join(from, "db-backup-20261113-000000.sqlite"));
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    db.close();

    const result = importBackupFromDir(root, from, { verify: verifyBackupFile });
    expect(result.ok).toBe(true);
    expect(result.imported).toContain("db-backup-20261113-000000.sqlite");
    expect(result.imported).toContain("app-data-backup-20261113-000000");
    /* 导入的件进了 data/backups/ */
    expect(
      fs.existsSync(path.join(root, "data", "backups", "db-backup-20261113-000000.sqlite")),
    ).toBe(true);
  });

  it("坏的 sqlite（读不通）跳过并记原因；同名不覆盖", () => {
    const from = path.join(root, "from-2");
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, "db-backup-20261113-000000.sqlite"), "not a sqlite");
    fs.mkdirSync(path.join(root, "data", "backups", "app-data-backup-20261113-000000"), {
      recursive: true,
    });

    const result = importBackupFromDir(root, from, { verify: verifyBackupFile });
    expect(result.ok).toBe(true);
    expect(result.imported).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("file is not a database");
  });

  it("目录里没有认得出的备份件 ⇒ 失败并说明", () => {
    const empty = path.join(root, "empty-dir");
    fs.mkdirSync(empty, { recursive: true });
    const result = importBackupFromDir(root, empty, { verify: verifyBackupFile });
    expect(result.ok, JSON.stringify(result)).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("没有认得出的备份件");
  });

  it("读不到的目录 ⇒ 失败并说明", () => {
    const result = importBackupFromDir(root, path.join(root, "no-such-dir"), {
      verify: verifyBackupFile,
    });
    expect(result.ok, JSON.stringify(result)).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("读不到这个目录");
  });
});
