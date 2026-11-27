/**
 * `pnpm test:affected`（ISSUE #5170）：改动面走 stdin，空集绝不兜成全量。
 */
import { describe, expect, it } from "vitest";

import { changedPaths } from "../scripts/affected-tests/test-affected.mjs";

describe("changedPaths", () => {
  it("三点 diff 与工作树 porcelain 并集去重、按名排序", () => {
    const rows = changedPaths({
      diff: "src/a.ts\ntests/a.test.ts\n",
      status: "M  src/a.ts\0 M tests/b.test.ts\0?? docs/x.md\0",
    });
    expect(rows).toEqual(["docs/x.md", "src/a.ts", "tests/a.test.ts", "tests/b.test.ts"]);
  });
  it("空面保持空，调用方据此退 2 而不是跑全量", () => {
    expect(changedPaths({ diff: "", status: "" })).toEqual([]);
  });
  it("行尾与 CRLF 不制造空路径", () => {
    expect(changedPaths({ diff: "a.ts\r\n\r\n", status: "" })).toEqual(["a.ts"]);
  });
});
