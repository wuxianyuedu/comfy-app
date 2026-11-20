import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

/**
 * `tools/start/agent-index.ps1` 的入口契约（ISSUE #4585）。
 *
 * 双击入口只做「定位项目根 → 直调 node → Complete-Entry 收尾」；建索引 / 体检的
 * 逻辑唯一实现在 `scripts/platform/agent-index.mjs`（= `pnpm agent:index [--init]`）。
 * 这里锁四件事：文件在、带 UTF-8 BOM（含中文的 `.ps1` 无 BOM 会被 PowerShell 5.1
 * 按 GBK 解码，R8）、引用跨平台 `.mjs` 而不是第二份逻辑、双击无参默认补 `--init`。
 * `#` 语法按 `{ syntax: "hash" }` 剥注释（同 `cross-platform-launcher.test.ts`）。
 */
const ENTRY = "tools/start/agent-index.ps1";
const LOGIC = "scripts/platform/agent-index.mjs";

describe("agent-index 双击入口契约", () => {
  const raw = fs.readFileSync(path.join(process.cwd(), ENTRY));
  const code = stripComments(raw.toString("utf8"), { syntax: "hash", trailing: true });

  it("入口存在，且以 UTF-8 with BOM 开头（含中文 .ps1 的硬要求，R8）", () => {
    expect(raw.length).toBeGreaterThan(0);
    // BOM 字节 = EF BB BF；写成 Buffer 比对，避开逐字节索引的 undefined 形状
    expect(raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
  });

  it("入口直调跨平台唯一实现 agent-index.mjs，不另写第二份索引逻辑", () => {
    expect(code).toContain(LOGIC);
    expect(code).toContain("& node");
    // codegraph / zg 的真实调用只许在 .mjs 里；入口出现「& codegraph」或行首
    // 「zg …」这类调用形状即分叉。注释 / [HINT] 里提到工具名（装法、自查口）不算。
    expect(code).not.toMatch(/&\s*(?<tool>codegraph|zg)\b/);
    expect(code).not.toMatch(/^\s*(?<tool>codegraph|zg)\s+\w/m);
  });

  it("双击无参默认补 --init（就地建索引），显式参数原样透传", () => {
    expect(code).toContain('"--init"');
    expect(code).toMatch(/\$effectiveArgs\s*=\s*if\s*\(\$/);
    expect(code).toMatch(/ValueFromRemainingArguments\s*=\s*\$true/);
  });

  it("收尾走 entry-common 的 Complete-Entry（双击场景等回车、透传真实退出码）", () => {
    expect(code).toContain("entry-common.ps1");
    expect(code).toContain("Get-ProjectRoot");
    expect(code).toContain("Complete-Entry");
  });
});
