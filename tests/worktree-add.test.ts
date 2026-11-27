/**
 * `pnpm worktree:add`（ISSUE #5174）：落点判据把硬规则 30 变成机器可判的禁令。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkWorktreeLocation } from "../scripts/devtools/worktree-add.mjs";

const root = path.resolve("G:/repo");
const tmp = path.resolve("G:/Temp");

describe("checkWorktreeLocation", () => {
  it("仓库 .worktrees/ 与系统临时目录放行", () => {
    expect(
      checkWorktreeLocation({ target: path.join(root, ".worktrees", "x"), root, tmp }).ok,
    ).toBe(true);
    expect(checkWorktreeLocation({ target: path.join(tmp, "x"), root, tmp }).ok).toBe(true);
  });
  it(".git/ 下、仓库里其它目录都拒绝", () => {
    expect(checkWorktreeLocation({ target: path.join(root, ".git", "wt-x"), root, tmp }).ok).toBe(
      false,
    );
    expect(checkWorktreeLocation({ target: path.join(root, "wt-x"), root, tmp }).ok).toBe(false);
  });
  it("大小写与分隔符差异不影响判据", () => {
    const v = checkWorktreeLocation({
      target: path.join(root, ".WORKTREES", "x").toLowerCase(),
      root: root.toLowerCase(),
      tmp: tmp.toLowerCase(),
    });
    expect(v.ok).toBe(true);
  });
});
