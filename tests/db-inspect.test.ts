/**
 * `pnpm db:inspect`（ISSUE #5171）：只读语句形状收口，写语句当场拒绝。
 */
import { describe, expect, it } from "vitest";

import { checkReadOnlySql } from "../scripts/db/db-inspect.mjs";

describe("checkReadOnlySql", () => {
  it("单条 SELECT / WITH 放行", () => {
    expect(checkReadOnlySql("SELECT count(*) AS c FROM task").ok).toBe(true);
    expect(checkReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x;").ok).toBe(true);
  });
  it("写语句与藏了第二条语句的输入拒绝", () => {
    expect(checkReadOnlySql("DELETE FROM task").ok).toBe(false);
    expect(checkReadOnlySql("SELECT 1; DROP TABLE task").ok).toBe(false);
    expect(checkReadOnlySql("SELECT 1; UPDATE task SET id = 2").ok).toBe(false);
  });
  it("空语句拒绝", () => {
    expect(checkReadOnlySql("").ok).toBe(false);
  });
});
