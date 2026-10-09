/**
 * 「参数化用例 `it.for` ⇄ `it.each`」门禁自测（规范 §11.15）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-it-each.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `it.each(...)`，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts` 的取舍）。
 *
 * 逐条钉判定口径：
 *   ① `it.each` / `describe.each` 都是站点（按名字收窄会漏）→ 该拦
 *   ② 棘轮：不超过基线就放行
 *   ③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看
 *   ④ 夹具字符串 / 注释里的 `.each(` → 不算站点
 *   ⑤ 判据自己的夹具文件 → 跳过
 *   ⑥ `--update` 拒绝把基线往上涨
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-test-it-each.cjs");
/** 判据复用 `check-test-concurrency.cjs` 导出的 `maskNonCode`，临时仓库要一起带上。 */
const DEP = path.join(SCRIPTS_DIR, "check-test-concurrency.cjs");

const VITEST = 'import { describe, expect, it } from "vitest";\n';

/**
 * 在临时仓库里跑真脚本。
 * @param files 相对路径 → 文件内容
 * @param args 命令行参数（如 `--report`）
 * @param baseline 预置的棘轮基线（不传则无基线文件 = 起点 0 处）
 */
function gate(
  files: Record<string, string>,
  args: string[] = [],
  baseline?: { total: number; files: Record<string, number> },
): { ok: boolean; output: string; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-it-each-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const src of [SCRIPT, DEP]) {
    copyFileSync(src, path.join(root, "scripts", path.basename(src)));
  }
  if (baseline) {
    writeFileSync(
      path.join(root, "scripts", ".test-it-each-baseline.json"),
      JSON.stringify(baseline),
    );
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-test-it-each.cjs");
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      root,
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}`, root };
  }
}

describe("it.each 门禁：该拦的形状（§11.15）", () => {
  it("① `it.each` 是站点 → 阻断，并点名站点与章节", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}it.each([[1, "a"]])("%s %s", (n, s) => {
  expect(n).toBe(1);
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
    expect(r.output).toContain("src/a.test.ts");
    expect(r.output).toContain("§11.15");
  });

  it("①′ `describe.each` 同样是站点（按名字收窄会漏）", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}describe.each([["x"]])("%s", (v) => {
  it("t", () => expect(v).toBe("x"));
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
  });

  it("①″ `test.each` 同样是站点", () => {
    const r = gate({
      "src/a.test.ts": `import { expect, test } from "vitest";
test.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("存量涨了：1 处");
  });
});

describe("it.each 门禁：该放的形状（§11.15）", () => {
  it("② 棘轮：不超过基线就放行", () => {
    const r = gate(
      {
        "src/a.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
      },
      [],
      { total: 1, files: { "src/a.test.ts": 1 } },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("②′ 收口后比基线少 → 放行并提示收紧", () => {
    const r = gate({ "src/a.test.ts": `${VITEST}it("x", () => {});\n` }, [], {
      total: 2,
      files: { "src/a.test.ts": 2 },
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("跑 `--update` 把基线收紧");
  });

  it("③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看", () => {
    const r = gate({
      "src/a.test.ts": `function it(_a: unknown, _b: unknown) {
  return undefined as never;
}
it.each([[1]])("x", () => {});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("④ 夹具字符串与注释里的 `.each(` → 不算站点（maskNonCode）", () => {
    const r = gate({
      "src/a.test.ts": `${VITEST}const FIXTURE = \`it.each([[1]])\`;
it("夹具字符串不算站点", () => {
  // describe.each 写在注释里也不算
  expect(FIXTURE).toContain("each");
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });

  it("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", () => {
    const r = gate({
      "tests/test-it-each-gate.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("OK");
  });
});

describe("it.each 门禁：基线收紧档（§11.15）", () => {
  it("⑥ `--update` 拒绝把基线往上涨", () => {
    const r = gate(
      {
        "src/a.test.ts": `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
it.each([[2]])("%s", (n) => expect(n).toBe(2));
`,
      },
      ["--update"],
      { total: 1, files: { "src/a.test.ts": 1 } },
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("--update 拒绝把基线往上涨");
  });

  it("⑥′ `--update` 把基线收紧到实测值", () => {
    const r = gate(
      { "src/a.test.ts": `${VITEST}it("x", () => {});\n` },
      ["--update"],
      { total: 3, files: { "src/a.test.ts": 3 } },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toContain("基线已收紧到 0 处");
  });
});
