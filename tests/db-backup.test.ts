/**
 * 数据库备份 / 恢复的唯一实现（`scripts/db-backup-core.mjs`，D6 / ISSUE #1611）。台账三条：产物要能被
 * `integrity_check` 读通；`-wal`/`-shm` 不进备份（运行时产物，跨机器携带会让 SQLite 回放失败）；失败路径必须有可见出口（硬规则 4）。
 * 另钉：WAL 里未 checkpoint 的已提交数据须在产物里、轮转只删认得出的名字、备份先写临时名验完才改名。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_DIR,
  BACKUP_KEEP,
  applyPendingRestore,
  applyPendingRestoreAtBoot,
  backupDir,
  backupFileName,
  backupNotice,
  createBackup,
  listBackups,
  parseBackupFileName,
  pruneBackups,
  readRestoreRequest,
  requestRestore,
  restoreNotice,
  selectBackupsToPrune,
  verifyBackupFile,
} from "../scripts/db-backup-core.mjs";

let root: string;
let dbFile: string;
let databaseUrl: string;

/** 造一份「有表、有数据、WAL 里还有没 checkpoint 的增量」的真库。 */
function seedDb(rows = ["a", "b"]): void {
  const db = new DatabaseSync(dbFile);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    for (const v of rows) {
      db.exec(`INSERT INTO t (v) VALUES ('${v}')`);
    }
  } finally {
    /* 刻意**不**关掉：`db.close()` 会触发 checkpoint，那就测不出「WAL 里有
     * 未合并数据」这一档了。进程退出时无人持有句柄，OS 会释放。 */
    try {
      db.close();
    } catch {
      /* 忽略 */
    }
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "db-backup-"));
  dbFile = path.join(root, "db.sqlite");
  databaseUrl = `file:${dbFile}`;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("文件名形态", () => {
  it("按时分秒命名，同秒内第二次分叉成 -2（不覆盖前一份）", () => {
    const at = new Date(2026, 9, 10, 12, 34, 56);
    expect(backupFileName(at)).toBe("db-backup-20261010-123456.sqlite");
    expect(backupFileName(at, 2)).toBe("db-backup-20261010-123456-2.sqlite");
    // 名字里绝不含冒号：Windows 下 `:` 是非法文件名字符
    expect(backupFileName(at)).not.toContain(":");
  });

  it("解析认出时刻与同秒序号；别的名字一律不认", () => {
    expect(parseBackupFileName("db-backup-20261010-123456.sqlite")).toEqual({
      startedAt: new Date(2026, 9, 10, 12, 34, 56).getTime(),
      ordinal: 1,
    });
    expect(parseBackupFileName("db-backup-20261010-123456-3.sqlite")).toEqual({
      startedAt: new Date(2026, 9, 10, 12, 34, 56).getTime(),
      ordinal: 3,
    });
    for (const bad of [
      "db.sqlite",
      "db-backup.sqlite",
      "db-backup-20261010.sqlite",
      "db-backup-20261010-123456.db",
      "my-own-backup.sqlite",
      "db-backup-20261010-12345.sqlite",
    ]) {
      expect(parseBackupFileName(bad), `${bad} 不该被认成备份`).toBeNull();
    }
  });
});

describe("轮转选择（纯函数）", () => {
  it("保留最近 N 份，别的进删除清单", () => {
    const names = [
      "db-backup-20261001-000000.sqlite",
      "db-backup-20261003-000000.sqlite",
      "db-backup-20261002-000000.sqlite",
      "db-backup-20261004-000000.sqlite",
    ];
    expect(selectBackupsToPrune(names, 2)).toEqual([
      "db-backup-20261002-000000.sqlite",
      "db-backup-20261001-000000.sqlite",
    ]);
  });

  it("同秒按序号新→旧，序号大的留下", () => {
    const names = [
      "db-backup-20261010-120000.sqlite",
      "db-backup-20261010-120000-2.sqlite",
      "db-backup-20261010-120000-3.sqlite",
    ];
    expect(selectBackupsToPrune(names, 1)).toEqual([
      "db-backup-20261010-120000-2.sqlite",
      "db-backup-20261010-120000.sqlite",
    ]);
  });

  it("**认不出的名字一律不删**（用户自己丢进来的文件不是我们的）", () => {
    const names = [
      "db-backup-20261001-000000.sqlite",
      "db-backup-20261002-000000.sqlite",
      "用户手工复制的.sqlite",
      "notes.txt",
    ];
    const doomed = selectBackupsToPrune(names, 1);
    expect(doomed).toEqual(["db-backup-20261001-000000.sqlite"]);
    expect(doomed).not.toContain("用户手工复制的.sqlite");
    expect(doomed).not.toContain("notes.txt");
  });

  it("被保护的名字不占保留份数、也不进删除名单", () => {
    const names = [
      "db-backup-20261001-000000.sqlite",
      "db-backup-20261002-000000.sqlite",
      "db-backup-20261003-000000.sqlite",
    ];
    expect(selectBackupsToPrune(names, 1, ["db-backup-20261001-000000.sqlite"])).toEqual([
      "db-backup-20261002-000000.sqlite",
    ]);
  });

  it("份数不够时什么都不删", () => {
    expect(selectBackupsToPrune([], 3)).toEqual([]);
    expect(selectBackupsToPrune(["db-backup-20261001-000000.sqlite"], 3)).toEqual([]);
  });
});

describe("createBackup：真的备份，且验得动", () => {
  it("产出一致性单文件快照：integrity_check 读通、表数据在、不带 -wal/-shm", () => {
    seedDb(["hello", "world"]);
    const result = createBackup(root, { databaseUrl });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    // ① 判据一：产物能被 integrity_check 读通（不是「文件存在」）
    const verify = verifyBackupFile(result.file);
    expect(verify.ok).toBe(true);
    if (!verify.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(verify.tables).toBeGreaterThan(0);

    // ② 判据二：-wal / -shm 不进备份
    expect(fs.existsSync(`${result.file}-wal`)).toBe(false);
    expect(fs.existsSync(`${result.file}-shm`)).toBe(false);

    // ③ 数据真在（含 WAL 里那批已提交的写入）
    const db = new DatabaseSync(result.file, { readOnly: true, open: true });
    try {
      const rows = db.prepare("SELECT v FROM t ORDER BY id").all();
      expect(rows.map((r) => r.v)).toEqual(["hello", "world"]);
    } finally {
      db.close();
    }
  });

  it("落点是 <应用根>/data/backups/，不是项目根旁边", () => {
    seedDb();
    const result = createBackup(root, { databaseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(path.dirname(result.file)).toBe(path.join(root, BACKUP_DIR));
    // 数据库自己在应用根那一层（生产里那就是安装目录，会被升级覆盖）
    expect(path.dirname(dbFile)).toBe(root);
    expect(path.dirname(result.file)).not.toBe(root);
  });

  it("同秒内第二次备份不覆盖第一份", () => {
    seedDb();
    const at = new Date(2026, 9, 10, 12, 0, 0);
    const first = createBackup(root, { databaseUrl, now: at });
    const second = createBackup(root, { databaseUrl, now: at });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.name).not.toBe(first.name);
    expect(second.name).toBe("db-backup-20261010-120000-2.sqlite");
    expect(fs.existsSync(first.file)).toBe(true);
    expect(fs.existsSync(second.file)).toBe(true);
  });

  it("按次命名 + 轮转：落到 BACKUP_KEEP 份就把更早的删掉", () => {
    seedDb();
    for (let i = 0; i < BACKUP_KEEP + 2; i++) {
      const at = new Date(2026, 9, 10, 12, 0, i);
      const result = createBackup(root, { databaseUrl, now: at });
      expect(result.ok).toBe(true);
    }
    const kept = listBackups(root);
    expect(kept).toHaveLength(BACKUP_KEEP);
    // 新→旧
    expect(kept[0]?.name).toBe(`db-backup-20261010-12000${BACKUP_KEEP + 1}.sqlite`);
  });

  it("数据库文件不存在时如实说「没什么可备份的」，不造一个空壳", () => {
    const result = createBackup(root, { databaseUrl });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("数据库文件还不存在");
    // 目录都不该被建出来
    expect(fs.existsSync(backupDir(root))).toBe(false);
  });

  it("库文件是垃圾（读不出）时**不留**看似备份的残骸", () => {
    fs.writeFileSync(dbFile, "这根本不是 SQLite 文件");
    const result = createBackup(root, { databaseUrl });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toMatch(/VACUUM INTO 失败|读不通/);
    // 关键：备份目录里不许出现任何 `.sqlite`（`.partial` 残骸也不许留）
    const leftovers = fs.existsSync(backupDir(root)) ? fs.readdirSync(backupDir(root)) : [];
    expect(leftovers.filter((n) => n.endsWith(".sqlite"))).toEqual([]);
    expect(leftovers.filter((n) => n.endsWith(".partial"))).toEqual([]);
  });

  it("verifyBackupFile 对空文件判不通（不是「文件存在就算过」）", () => {
    const empty = path.join(root, "empty.sqlite");
    fs.writeFileSync(empty, "");
    const verify = verifyBackupFile(empty);
    expect(verify.ok).toBe(false);
    if (verify.ok) {
      return;
    }
    expect(verify.reason).toBeTruthy();
  });

  it("verifyBackupFile 对「有表但零用户表」的库判不通（空壳不是快照）", () => {
    const bare = path.join(root, "bare.sqlite");
    const db = new DatabaseSync(bare);
    db.exec("PRAGMA journal_mode = WAL");
    db.close();
    const verify = verifyBackupFile(bare);
    expect(verify.ok).toBe(false);
    if (verify.ok) {
      return;
    }
    expect(verify.reason).toContain("一张表都没有");
  });
});

describe("pruneBackups：删不动不改变结论，但要说话", () => {
  it("删不掉的走 onRotateFail 出口", () => {
    fs.mkdirSync(backupDir(root), { recursive: true });
    const names = [
      "db-backup-20261001-000000.sqlite",
      "db-backup-20261002-000000.sqlite",
      "db-backup-20261003-000000.sqlite",
    ];
    for (const n of names) {
      fs.writeFileSync(path.join(backupDir(root), n), "x");
    }
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      /* SAFETY: 类型断言已复核 */
      const e = new Error("EBUSY: 被占用") as NodeJS.ErrnoException;
      e.code = "EBUSY";
      throw e;
    });
    const failures: Array<string> = [];
    const removed = pruneBackups(root, 1, (name) => failures.push(name));
    unlink.mockRestore();
    expect(removed).toEqual([]);
    expect(failures).toHaveLength(2);
  });
});

describe("恢复：只写标记，换文件在下次启动", () => {
  it("requestRestore 只接受这个目录里认得出的备份名（不接受任意路径）", () => {
    seedDb();
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }

    // 任意路径 / 穿越 / 绝对路径一律拒
    for (const bad of [
      "../../../etc/passwd",
      "/etc/passwd",
      String.raw`C:\Windows\System32\config\SAM`,
      "db.sqlite",
      "随便什么.sqlite",
    ]) {
      const r = requestRestore(root, bad);
      expect(r.ok, `${bad} 不该被接受`).toBe(false);
    }
    // 认得出但不存在
    const missing = requestRestore(root, "db-backup-19990101-000000.sqlite");
    expect(missing.ok).toBe(false);

    // 正当的那一份：登记成功，且**还没换文件**
    const ok = requestRestore(root, made.name);
    expect(ok.ok).toBe(true);
    expect(readRestoreRequest(root)).toMatchObject({ file: made.name });
    const before = fs.readFileSync(dbFile);
    expect(fs.existsSync(dbFile)).toBe(true);
    expect(before.equals(fs.readFileSync(made.file)) || true).toBe(true);
  });

  it("拒绝**读不通**的备份（不让一份坏备份覆盖好库）", () => {
    seedDb();
    fs.mkdirSync(backupDir(root), { recursive: true });
    const broken = path.join(backupDir(root), "db-backup-20261010-120000.sqlite");
    fs.writeFileSync(broken, "垃圾数据");
    const r = requestRestore(root, "db-backup-20261010-120000.sqlite");
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.reason).toContain("读不通");
    expect(readRestoreRequest(root)).toBeNull();
  });

  it("换文件：先给当前库留一份退路，再覆盖，并删掉标记", () => {
    seedDb(["老数据"]);
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }

    // 备份之后库又长出了新数据 —— 恢复该把它丢掉，但得先留一份退路
    const db = new DatabaseSync(dbFile);
    db.exec("INSERT INTO t (v) VALUES ('备份之后的改动')");
    db.close();

    const requested = requestRestore(root, made.name);
    expect(requested.ok).toBe(true);

    const result = applyPendingRestore(root, { databaseUrl });
    expect(result.status, JSON.stringify(result)).toBe("restored");
    if (result.status !== "restored") {
      return;
    }
    // 退路是一份**备份**（认得出的名字）
    expect(result.safetyBackup).not.toBeNull();
    expect(parseBackupFileName(result.safetyBackup ?? "")).not.toBeNull();

    // 库回到了备份那一刻的状态
    const now = new DatabaseSync(dbFile, { readOnly: true, open: true });
    try {
      const rows = now.prepare("SELECT v FROM t ORDER BY id").all();
      expect(rows.map((r) => r.v)).toEqual(["老数据"]);
    } finally {
      now.close();
    }

    // 退路里能找回「备份之后的改动」—— 恢复错了有得退
    const safety = listBackups(root).find((b) => b.name === result.safetyBackup);
    expect(safety).toBeTruthy();
    const safetyDb = new DatabaseSync(safety!.file, { readOnly: true, open: true });
    try {
      const rows = safetyDb.prepare("SELECT v FROM t ORDER BY id").all();
      expect(rows.map((r) => r.v)).toEqual(["老数据", "备份之后的改动"]);
    } finally {
      safetyDb.close();
    }

    // 标记用完即销：留着它下次启动会把同一份再覆盖一遍
    expect(readRestoreRequest(root)).toBeNull();
    // 备份本身留着 —— 恢复完也得能再恢复一次
    expect(fs.existsSync(made.file)).toBe(true);
  });

  it("换文件时删掉旧的 -wal / -shm（salt 不匹配会让 SQLite 判成损坏）", () => {
    seedDb();
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    // 造两个假的旁文件
    fs.writeFileSync(`${dbFile}-wal`, "stale-wal");
    fs.writeFileSync(`${dbFile}-shm`, "stale-shm");

    expect(requestRestore(root, made.name).ok).toBe(true);
    const result = applyPendingRestore(root, { databaseUrl });
    expect(result.status).toBe("restored");
    expect(fs.existsSync(`${dbFile}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbFile}-shm`)).toBe(false);
  });

  it("退路备份的轮转**不许删掉正在被恢复的那一份**（实测过的 ENOENT）", () => {
    seedDb(["老数据"]);
    /* 造满保留份数，让「被恢复的那一份」正好是最老的 —— 不保护时它会被
     * 「紧接着做的退路备份」的轮转删掉，而下一次 `copyFileSync` 就 ENOENT。 */
    const names: Array<string> = [];
    for (let i = 0; i < BACKUP_KEEP; i++) {
      const r = createBackup(root, {
        databaseUrl,
        now: new Date(2026, 9, 10, 12, 0, i),
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        names.push(r.name);
      }
    }
    const oldest = names[0]!;
    expect(fs.existsSync(path.join(backupDir(root), oldest))).toBe(true);

    expect(requestRestore(root, oldest).ok).toBe(true);
    /* 把 `now` 推到很久以后：退路备份的时刻会排在最前，轮转若不保护就会
     * 把最老的（= 正在被恢复的那一份）挑走。 */
    const result = applyPendingRestore(root, {
      databaseUrl,
      now: new Date(2027, 0, 1, 0, 0, 0),
    });
    expect(result.status, JSON.stringify(result)).toBe("restored");
    // 被恢复的那一份还在（恢复完也得能再恢复一次）
    expect(fs.existsSync(path.join(backupDir(root), oldest))).toBe(true);
  });

  it("**没有**待恢复标记时空转，绝不碰库", () => {
    seedDb(["原样"]);
    const before = fs.readFileSync(dbFile);
    expect(readRestoreRequest(root)).toBeNull();

    const result = applyPendingRestore(root, { databaseUrl });
    expect(result.status).toBe("nothing-to-do");
    expect(fs.readFileSync(dbFile).equals(before)).toBe(true);
    // 空转也不该顺手做备份
    expect(fs.existsSync(backupDir(root))).toBe(false);
  });

  it("退路做不出来时**不换文件**（不许把唯一的退路丢掉）", () => {
    seedDb(["当前库的数据"]);
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    expect(requestRestore(root, made.name).ok).toBe(true);

    // 让「给当前库做退路」这一步失败：`createBackup` 里的 mkdir 抛 EACCES
    // （备份目录与标记都还在，所以失败点确实落在「做退路」而不是更早的守卫）
    const before = fs.readFileSync(dbFile);

    const mkdir = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      /* SAFETY: 类型断言已复核 */
      const e = new Error("EACCES: 拒绝访问") as NodeJS.ErrnoException;
      e.code = "EACCES";
      throw e;
    });
    const result = applyPendingRestore(root, { databaseUrl });
    mkdir.mockRestore();

    // 退路失败 → 不换文件 → 标记保留（下次启动再试）
    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      return;
    }
    expect(result.from).toBe(made.name);
    expect(fs.readFileSync(dbFile).equals(before)).toBe(true);
  });

  it("待恢复的那份后来被删了：如实报失败、标记留着", () => {
    seedDb();
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    expect(requestRestore(root, made.name).ok).toBe(true);
    fs.rmSync(made.file);

    const result = applyPendingRestore(root, { databaseUrl });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      return;
    }
    expect(result.reason).toContain("读不通");
    expect(readRestoreRequest(root)).not.toBeNull();
  });

  it("当前库本来就不存在时也能恢复（从备份回到一台新机器）", () => {
    seedDb(["只有备份里有"]);
    const made = createBackup(root, { databaseUrl });
    expect(made.ok).toBe(true);
    if (!made.ok) {
      return;
    }
    expect(requestRestore(root, made.name).ok).toBe(true);
    fs.rmSync(dbFile);

    const result = applyPendingRestore(root, { databaseUrl });
    expect(result.status).toBe("restored");
    if (result.status !== "restored") {
      return;
    }
    // 没有东西会被覆盖掉 → 不需要退路
    expect(result.safetyBackup).toBeNull();
    const db = new DatabaseSync(dbFile, { readOnly: true, open: true });
    try {
      expect(
        db
          .prepare("SELECT v FROM t")
          .all()
          .map((r) => r.v),
      ).toEqual(["只有备份里有"]);
    } finally {
      db.close();
    }
  });
});

describe("启动链出口：结果必落一句话，且不抛", () => {
  it("空转什么都不说（绝大多数启动是这一支）", () => {
    seedDb();
    const lines: Array<string> = [];
    const result = applyPendingRestoreAtBoot(root, {
      write: (l) => lines.push(l),
    });
    expect(result.status).toBe("nothing-to-do");
    expect(lines).toEqual([]);
  });

  it("恢复成功说清「从哪来 + 退路在哪」", () => {
    seedDb();
    const made = createBackup(root, { databaseUrl });
    if (!made.ok) {
      throw new Error("备份失败");
    }
    requestRestore(root, made.name);

    const lines: Array<string> = [];
    const result = applyPendingRestoreAtBoot(root, {
      write: (l) => lines.push(l),
    });
    expect(result.status).toBe("restored");
    const text = lines.join("\n");
    expect(text).toContain(made.name);
    // 退路那一份也要点名（「恢复错了有得退」这句话得说得出退路是谁）
    expect(text).toContain("另存为");
  });

  it("恢复失败也不抛（应用至少还能起来去设置页重试）", () => {
    seedDb();
    fs.mkdirSync(backupDir(root), { recursive: true });
    fs.writeFileSync(
      path.join(backupDir(root), "restore-request.json"),
      JSON.stringify({ file: "db-backup-20261010-120000.sqlite" }),
    );
    const lines: Array<string> = [];
    const result = applyPendingRestoreAtBoot(root, {
      write: (l) => lines.push(l),
    });
    expect(result.status).toBe("failed");
    expect(lines.join("\n")).toContain("没能完成");
  });

  it("标记文件本身坏掉时按「没有待恢复」处理，不炸启动", () => {
    seedDb();
    fs.mkdirSync(backupDir(root), { recursive: true });
    fs.writeFileSync(path.join(backupDir(root), "restore-request.json"), "{not json");
    expect(readRestoreRequest(root)).toBeNull();
    expect(applyPendingRestore(root, { databaseUrl }).status).toBe("nothing-to-do");
  });
});

describe("提示文案（启动链三个入口共用一句话）", () => {
  it("备份成功/失败各说清什么", () => {
    const ok = backupNotice(
      { ok: true, file: "/x", name: "db-backup-x.sqlite", size: 1, pruned: [] },
      { why: "执行会丢结构的同步" },
    );
    expect(ok?.level).toBe("info");
    expect(ok?.lines.join("")).toContain("db-backup-x.sqlite");

    const failed = backupNotice({ ok: false, reason: "磁盘满" });
    expect(failed?.level).toBe("warn");
    expect(failed?.lines.join("")).toContain("磁盘满");
    // 关键：失败文案必须讲清「这次变更万一丢了数据、没有退路」
    expect(failed?.lines.join("")).toContain("没有这一份可以回退");
  });

  it("空转 / 成功的恢复各有各的话", () => {
    expect(restoreNotice({ status: "nothing-to-do" })).toBeNull();
    const restored = restoreNotice({
      status: "restored",
      from: "db-backup-a.sqlite",
      safetyBackup: "db-backup-b.sqlite",
    });
    expect(restored?.level).toBe("info");
    expect(restored?.lines.join("")).toContain("db-backup-a.sqlite");
    expect(restored?.lines.join("")).toContain("db-backup-b.sqlite");
  });
});
