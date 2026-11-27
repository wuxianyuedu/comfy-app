/**
 * `pnpm inspect:runtime`（ISSUE #5169）：归属三分（own / session / foreign），foreign 只列不碰。
 */
import { describe, expect, it } from "vitest";

import { ownershipOf } from "../scripts/devtools/inspect-runtime.mjs";

describe("ownershipOf", () => {
  it("本检出 PID 记 own，会话锚点记 session，其余记 foreign", () => {
    const rows = ownershipOf(
      new Map([
        [11, "node G:/repo/scripts/dev.mjs"],
        [22, "node D:/other/scripts/dev.mjs"],
        [33, "node G:/repo/scripts/start.mjs"],
      ]),
      [11],
      [33],
    );
    expect(rows.find((r) => r.pid === 11)?.owner).toBe("own");
    expect(rows.find((r) => r.pid === 22)?.owner).toBe("foreign");
    expect(rows.find((r) => r.pid === 33)?.owner).toBe("session");
  });
  it("命令行截断到 200 字，避免把整条命令刷满屏", () => {
    const rows = ownershipOf(new Map([[55, "x".repeat(300)]]), [], []);
    expect(rows[0]?.cmdline).toHaveLength(200);
  });
});
