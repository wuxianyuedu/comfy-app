/**
 * `pnpm status:checkout`（ISSUE #5168）：porcelain 按列解析、worktree 清单读取，
 * 缺省零网络（不声称「已最新」）。
 */
import { describe, expect, it } from "vitest";

import { statusSummary, worktreePaths } from "../scripts/devtools/checkout-status.mjs";

describe("statusSummary", () => {
  it("按 X / Y 两列分三档，不把未改动的读成已暂存", () => {
    const s = statusSummary("M  a.ts\n M b.ts\n?? c.ts\nM  d.ts\n");
    expect(s.staged).toEqual(["a.ts", "d.ts"]);
    expect(s.changed).toEqual(["b.ts"]);
    expect(s.untracked).toEqual(["c.ts"]);
    expect(s.total).toBe(4);
  });
});

describe("worktreePaths", () => {
  it("只取 worktree 行，忽略其余 porcelain 字段", () => {
    expect(
      worktreePaths(
        "worktree /repo\nHEAD 1234\nbranch refs/heads/master\n\nworktree /repo/.worktrees/x\nHEAD 5678\n",
      ),
    ).toEqual(["/repo", "/repo/.worktrees/x"]);
  });
});
