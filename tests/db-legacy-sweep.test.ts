/**
 * 历史时间戳写法的一次性归一（`scripts/db-legacy-sweep.mjs`，ISSUE #1501）。
 *
 * `project` 表里混着两种 `createdAt` / `updatedAt`：裸毫秒串与 ISO 串。
 * 写入侧早就只有 ISO（`schema.ts` 的 `dateNotNull`），所以前者是**读进来就得
 * 挡着**的历史痕迹 —— 归一之后读取侧只剩一条路径。
 *
 * 三条判据，每条都对应一种会静默走偏的写法：
 *   1. 只认「整串十进制数字」这一种形状（`Number(v)` 会把 `" 12 "` / `"1e3"`
 *      一并认成数字，那样列里的第三种东西就再也报不出来）；
 *   2. 解不出合法时间的值**原样留着并报出来** —— 归一不能顺手把事情抹平；
 *   3. 幂等：第二次跑是空操作（它挂在 `pnpm db:push` 收尾，每次都会跑到）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  epochMsToIso,
  sweepLegacyTimestamps,
} from "../scripts/db-legacy-sweep.mjs";

let tmp: string;
let dbFile: string;

/** 清洗的输出这里不关心（另有用例逐行断言），统一丢给一个空接收器。
 *  写成具名函数而不是 `() => {}`：后者会被 eslint 的 no-empty-function 判成
 *  「可能忘了实现」，而这里是有意的静音。 */
const noop = (): void => undefined;

function open(): DatabaseSync {
  return new DatabaseSync(dbFile, { open: true });
}

function rows() {
  const db = open();
  try {
    return db
      .prepare("SELECT id, createdAt, updatedAt FROM project ORDER BY id")
      .all();
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-sweep-"));
  dbFile = path.join(tmp, "db.sqlite");
  const db = open();
  db.exec(
    "CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT, createdAt TEXT, updatedAt TEXT)",
  );
  db.close();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("epochMsToIso —— 形状判据", () => {
  it("整串十进制数字 → ISO", () => {
    expect(epochMsToIso("1787379642808")).toBe("2026-08-22T06:20:42.808Z");
  });

  it("已是 ISO / 空串 / 非字符串 → null（原样保留）", () => {
    expect(epochMsToIso("2026-09-23T12:55:34.886Z")).toBeNull();
    expect(epochMsToIso("")).toBeNull();
    expect(epochMsToIso(1787379642808)).toBeNull();
    expect(epochMsToIso(null)).toBeNull();
  });

  it("「看起来像数字」但不是整串十进制 → null（第三种形状必须报出来，不能顺手吞掉）", () => {
    // 这几个是 `Number(v)` 会认成数字、而列里其实不是裸毫秒的值。
    expect(epochMsToIso(" 1787379642808 ")).toBeNull();
    expect(epochMsToIso("1e13")).toBeNull();
    expect(epochMsToIso("1787379642808.0")).toBeNull();
  });
});

describe("sweepLegacyTimestamps —— 归一与幂等", () => {
  it("裸毫秒那几列归一成 ISO，已经是 ISO 的列一动不动", () => {
    const db = open();
    db.prepare("INSERT INTO project VALUES (?,?,?,?)").run(
      "proj_a",
      "未命名",
      "1787379642808", // 裸毫秒（ISSUE #1501 现场的那种沉积）
      "2026-09-23T12:55:34.886Z", // 已经是目标形态
    );
    db.close();

    const summary = sweepLegacyTimestamps(dbFile, noop);
    expect(summary).toMatchObject({ rows: 1, columns: 1, skipped: [] });
    expect(rows()).toEqual([
      {
        id: "proj_a",
        createdAt: "2026-08-22T06:20:42.808Z",
        updatedAt: "2026-09-23T12:55:34.886Z",
      },
    ]);

    /* 幂等：第二次跑什么都不改、也什么都不报。 */
    const again = sweepLegacyTimestamps(dbFile, noop);
    expect(again).toMatchObject({ rows: 0, columns: 0, skipped: [] });
  });

  it("同一行两列都是裸毫秒 → 两列都归一（columns 记列数、rows 记行数）", () => {
    const db = open();
    db.prepare("INSERT INTO project VALUES (?,?,?,?)").run(
      "proj_b",
      "未命名_2",
      "1787379642808",
      "1787379642808",
    );
    db.close();

    expect(sweepLegacyTimestamps(dbFile, noop)).toMatchObject({
      rows: 1,
      columns: 2,
    });
  });

  it("解析不了的值原样保留并报出来（归一不许顺手抹平）", () => {
    const db = open();
    db.prepare("INSERT INTO project VALUES (?,?,?,?)").run(
      "proj_c",
      "x",
      "2026-09-23T12:55:34.886Z",
      "not-a-date",
    );
    db.close();

    const lines: string[] = [];
    const summary = sweepLegacyTimestamps(dbFile, (l) => lines.push(l));
    expect(summary.skipped).toEqual(["proj_c.updatedAt = not-a-date"]);
    expect(lines.join("")).toContain("proj_c.updatedAt = not-a-date");
    expect(rows()[0]).toMatchObject({ updatedAt: "not-a-date" });

    /* 写盘只按「真的改了东西」发生：这一档没有可归一的列，库不动。 */
    expect(summary.rows).toBe(0);
  });

  it("库文件不存在 / 没有 project 表 → 空操作（不抛错，不拦 `pnpm db:push`）", () => {
    fs.rmSync(dbFile, { force: true });
    expect(sweepLegacyTimestamps(dbFile, noop)).toMatchObject({
      rows: 0,
      columns: 0,
    });

    const db = open();
    db.exec("CREATE TABLE other (id TEXT PRIMARY KEY, createdAt TEXT)");
    db.close();
    expect(sweepLegacyTimestamps(dbFile, noop)).toMatchObject({
      rows: 0,
      columns: 0,
    });
  });
});
