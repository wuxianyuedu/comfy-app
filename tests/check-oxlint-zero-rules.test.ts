/**
 * `check-oxlint-zero-rules.mjs` 的契约测试（ISSUE #3016；台账 #2777）：判「已清零规则集」防回潮闸自身可信。
 * 正控：全仓档跑一遍，41 条规则 0 命中、退 0（并钉住退码只 0/1/2 三态：「没跑起来」退 2）。
 * 负控：仓外临时目录造回潮夹具（`x !== undefined ? x : 兜底`，#3016 判空三元反面），路径档须判红退 1、指回夹具与 `unicorn(no-negated-condition)`；只选语法级规则（路径档不挂 `--type-aware`，夹具无 tsconfig）。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/check-oxlint-zero-rules.mjs";

describe("已清零 oxlint 规则集闸（#3016）", () => {
  it(
    "正控：全仓档清单内规则 0 命中，退 0",
    { timeout: 300_000 },
    () => {
      const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
      // 退 2 = 没跑起来（oxlint 起不来 / 输出不是 JSON / 一份文件都没扫到）：
      // 那时红与绿都不构成结论，所以这里把 stderr 一并带进断言消息，便于归因。
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("0 命中");
    },
  );

  it("负控：判空三元否定侧在前（`x !== undefined ? x : 兜底`）必须判红", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      writeFileSync(
        fixture,
        'export function pick(x: string | undefined): string {\n  return x !== undefined ? x : "fallback";\n}\n',
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
      const out = `${r.stdout}${r.stderr}`;
      expect(out).toContain("unicorn(no-negated-condition)");
      expect(out).toContain("fixture.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控的对照：肯定侧在前（`x === undefined ? 兜底 : x`，#3016 口径）必须放行", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oxlint-zero-rules-"));
    try {
      const fixture = path.join(dir, "fixture.ts");
      writeFileSync(
        fixture,
        'export function pick(x: string | undefined): string {\n  return x === undefined ? "fallback" : x;\n}\n',
        "utf8",
      );
      const r = spawnSync(process.execPath, [SCRIPT, fixture], { encoding: "utf8" });
      expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 判据自己被挂进门槛：三个登记面都在岗 —— pre-commit 的 D 组 `run` 行
 * （`check-gate-executors.cjs` 的文本解析面）、quality-gate 的 GATES 条目、
 * package.json 的独立入口脚本。少任何一面，这扇闸就只剩「文档承诺」。
 */
describe("门槛接线", () => {
  it("pre-commit D 组有这条 run 行", () => {
    const hook = readFileSync(".githooks/pre-commit", "utf8");
    expect(hook).toContain("node scripts/check-oxlint-zero-rules.mjs");
  });

  it("quality-gate.mjs 的 GATES 登记了这个门禁", () => {
    const gate = readFileSync("scripts/quality-gate.mjs", "utf8");
    expect(gate).toContain("check-oxlint-zero-rules.mjs");
  });

  it("package.json 有独立入口脚本", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:oxlint-zero-rules"]).toBe(`node ${SCRIPT}`);
  });

  it("清单里登记着 #3016 这条的源头规则（no-negated-condition）", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain('"unicorn/no-negated-condition"');
  });
});
