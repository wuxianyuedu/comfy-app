// db-schema-ready 的负结果不缓存（ISSUE #3875）：首探未就绪（表还没建 / PRAGMA
// 撞锁）不能把 reaper 等库侧副作用禁用到进程退出。用真临时库钉行为：
// 「文件不存在 → false」之后原地建表，不重置缓存再探必须翻真。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { isSchemaReady, resetSchemaReadinessCache } from "../src/lib/db-schema-ready";

describe("isSchemaReady 负结果不缓存（ISSUE #3875）", () => {
  it("首探 missing 后原地建表，再探翻真（不重置缓存）", () => {
    const dir = mkdtempSync(join(tmpdir(), "comfy-schema-ready-"));
    const dbFile = join(dir, "db.sqlite");
    const url = `file:${dbFile}`;
    resetSchemaReadinessCache();

    // 库文件还不存在：not ready，调用方应跳过本轮。
    expect(isSchemaReady(url)).toBe(false);

    // db:push 后到：同一进程生命周期内表「从无到有」。负结果若被缓存，
    // 这里会仍然 false（正是 #3875 要修的静默禁用）。
    new DatabaseSync(dbFile).exec("CREATE TABLE task (id TEXT PRIMARY KEY)");
    expect(isSchemaReady(url)).toBe(true);

    // 肯定结论是粘性的：再探不再开新连接也能命中缓存。
    expect(isSchemaReady(url)).toBe(true);
  });
});
