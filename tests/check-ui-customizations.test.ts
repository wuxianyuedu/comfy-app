/**
 * `ui/` 定制标记 ⟺ 台账 门禁自测（规范 docs/standards/16 §16.8）。
 *
 * 这条门禁的价值全在判定口径上：太松（标记随便埋在哪都算、或把别的小节里的
 * 同名表格行当成登记）→ `shadcn add` 覆盖掉定制时没有人被拦；太紧（把只在
 * import 别名上不同的文件也要求登记）→ 20 多个文件无意义地进台账，门禁变噪音。
 *
 * 所以用「临时仓库 + 只放被测文件」跑**真脚本**（脚本按自身位置解析仓库根，
 * 必须把它一起复制进去，否则扫的还是真实仓库 —— 那样用例会「总是通过」），
 * 断言「该拦的拦、不该误伤的放过」。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  __dirname,
  "../scripts/check-ui-customizations.cjs",
);
const DOC = "docs/standards/16-shadcn-ui与表单校验.md";

/** 台账小节（形状与真实文档一致：标题 + 四列表格）。 */
function docWithLedger(rows: string[]): string {
  return [
    "## 16.7 不碰 ui/ 的硬规则",
    "",
    "| 文件 | 说明 | 为什么 | 怎么补 |",
    "| --- | --- | --- | --- |",
    "| `not-a-ledger-row.tsx` | 这一节里的表格**不算**登记 | —— | —— |",
    "",
    "## 16.8 `ui/` 本地改动台账（覆盖前必读）",
    "",
    "| 文件 | 本仓库的定制 | 为什么 | 覆盖后怎么补 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function ledgerRow(file: string): string {
  return `| \`${file}\` | 定制 | 因为 | 补法 |`;
}

const MARKER =
  "/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */";

/** 在临时仓库里跑真脚本（cwd = 临时仓库根）。 */
function gate(files: Record<string, string>): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "ui-customizations-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  try {
    return {
      ok: true,
      output: execFileSync(
        process.execPath,
        [path.join(root, "scripts", path.basename(SCRIPT))],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("ui/ 定制标记 ⟺ 台账", () => {
  it("标记与台账一一对应时通过", () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("button.tsx")]),
      "src/components/ui/button.tsx": `${MARKER}\nimport { cn } from "~/lib/utils";\n`,
    });
    expect(result.output).toContain("与台账一致");
    expect(result.ok).toBe(true);
  });

  it("带了标记却没登记：拦下并指路到台账", () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("dialog.tsx")]),
      "src/components/ui/button.tsx": `${MARKER}\n`,
      "src/components/ui/dialog.tsx": `${MARKER}\n`,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("带了标记，但台账里没有它");
  });

  it("登记了却没标记：拦下并给出可照抄的标记行", () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("button.tsx"), ledgerRow("tooltip.tsx")]),
      "src/components/ui/button.tsx": `${MARKER}\n`,
      "src/components/ui/tooltip.tsx": `"use client";\n\nimport * as React from "react";\n`,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("文件头没有标记");
    expect(result.output).toContain("ui-customized:");
  });

  it('`"use client"` 指令行之后的标记算数（不能要求它挤在指令之前）', () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("tooltip.tsx")]),
      "src/components/ui/tooltip.tsx": `"use client";\n${MARKER}\nimport * as React from "react";\n`,
    });
    expect(result.ok).toBe(true);
  });

  it("标记埋在第 4 行（文件头之外）不算：等于没登记，拦下", () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("button.tsx")]),
      "src/components/ui/button.tsx": `import Link from "next/link";\nimport { cn } from "~/lib/utils";\n\n${MARKER}\n`,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("文件头没有标记");
  });

  it("别的章节里的同名表格行不算登记（范围只认 §16.8 小节内）", () => {
    /* 临时仓库里那份文档的 §16.7 有一行 `not-a-ledger-row.tsx`；这里把它换成
     * 真实存在的文件名，验证门禁不会把别的小节的表格当成台账。 */
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("button.tsx")]).replace(
        "not-a-ledger-row.tsx",
        "button.tsx",
      ),
      "src/components/ui/button.tsx": `${MARKER}\n`,
    });
    expect(result.ok).toBe(true);
  });

  it("测试文件不参与判定（`*.test.tsx` 不该逼人登记）", () => {
    const result = gate({
      [DOC]: docWithLedger([ledgerRow("button.tsx")]),
      "src/components/ui/button.tsx": `${MARKER}\n`,
      "src/components/ui/button.test.tsx": `${MARKER}\n`,
    });
    expect(result.ok).toBe(true);
  });
});
