/**
 * `changelog:new/list/merge`（ISSUE #5172）：文件名与段落收口。
 */
import { describe, expect, it } from "vitest";

import { fragmentFileName, SECTIONS } from "../scripts/docs/changelog-entry.mjs";

describe("fragmentFileName", () => {
  it("号 + slug 归一成命名约定", () => {
    expect(fragmentFileName({ number: 5165, slug: "ship-edit-issue" })).toBe(
      "5165-ship-edit-issue.md",
    );
    expect(fragmentFileName({ number: "0", slug: "Manual  Fix!" })).toBe("0-manual-fix.md");
  });
  it("段落词表含必填的 Added / Fixed", () => {
    expect(SECTIONS).toContain("Added");
    expect(SECTIONS).toContain("Fixed");
  });
});
