/**
 * src/lib 非空断言 `!` 棘轮自检:把 `scripts/check-non-null-assertions.cjs`
 * 当黑盒跑在临时工作区上,验证它真能按 AST 认出 `NonNullExpression`、按每
 * 文件基线判「只挡新增、允许下降」。
 *
 * 规范:docs/standards/13-提交与-code-review.md §13.5.6 与
 * docs/standards/18-lib层规范.md §18.6
 *
 * 为什么值得有门禁:本轮类型安全审查已把 lib 里 filter/map 不 narrow 的 13 处
 * 病灶消化完(PR-1/2/5/8/12),但 lib 里仍有 ~89 处 `arr[i]!` 是
 * `noUncheckedIndexedAccess` 合法惯用法。直接开 eslint `no-non-null-assertion`
 * 一次报 100+、评审全是噪声;不开又挡不住下一轮病灶长出。基线棘轮是
 * 与 §12.13 函数长度同构的合理路径。
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-non-null-assertions.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-non-null-assertions.cjs"), ...args],
      {
        cwd: workdir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_PATH: join(process.cwd(), "node_modules"),
        },
      },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function writeLibFile(rel: string, body: string): void {
  const abs = join(workdir, "src", "lib", rel);
  mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "non-null-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(
    SCRIPT,
    join(workdir, "scripts", "check-non-null-assertions.cjs"),
  );
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-non-null-assertions AST 判据", () => {
  it("认 arr[i]! 与 match[N]! 这两种 noUncheckedIndexedAccess 惯用法", () => {
    writeLibFile(
      "sample.ts",
      `function pick(arr: string[], i: number): string { return arr[i]!; }
function grab(re: RegExp, s: string): string { const m = re.exec(s); return m ? m[1]! : ""; }
export { pick, grab };`,
    );
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/总数 2|total 2|2 处/);
  });

  it("不误伤 `!==` / `!x` / 行注释与块注释里的裸 `!`", () => {
    writeLibFile(
      "clean.ts",
      `// 这里 ! 只在注释里! 举例
/* 块注释也不该被算! */
export function ok(a: string | null): boolean {
  if (a !== null && !a) return true;   // !== 与 !a 都不是 NonNullExpression
  return false;
}
`,
    );
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });

  it("跳过 .test.ts / __tests__ / .d.ts,只扫 lib 生产代码", () => {
    writeLibFile(
      "a.test.ts",
      `const x = [1] as (number | undefined)[]; expect(x[0]!).toBe(1);`,
    );
    writeLibFile(
      "b.d.ts",
      `declare const v: { n?: number }; export declare const w: number; void (v.n!);`,
    );
    mkdirSync(join(workdir, "src", "lib", "__tests__"), { recursive: true });
    writeFileSync(
      join(workdir, "src", "lib", "__tests__", "c.ts"),
      `const arr = [1] as (number | undefined)[]; export const x = arr[0]!;`,
      "utf8",
    );
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });
});

describe("check-non-null-assertions 棘轮", () => {
  it("--update 建立基线;此后同数量 OK、新增阻断、下降允许", () => {
    writeLibFile(
      "mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;
export const b = arr[0]!;`,
    );
    // 无基线:提示先 --update
    const first = run();
    expect(first.code).toBe(0);
    expect(first.output).toMatch(/基线未建立/);
    // 建立基线
    const upd = run(["--update"]);
    expect(upd.code).toBe(0);
    const baseline = JSON.parse(
      readFileSync(
        join(workdir, "scripts", ".non-null-assertions-baseline.json"),
        "utf8",
      ),
    ) as { ruleVersion: number; total: number; files: Record<string, number> };
    expect(baseline.total).toBe(2);
    expect(baseline.files["src/lib/mod.ts"]).toBe(2);
    // 同数量:OK
    const ok = run();
    expect(ok.code).toBe(0);
    expect(ok.output).toMatch(/OK/);
    // 新增第三处:阻断
    writeLibFile(
      "mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;
export const b = arr[0]!;
export const c = arr[0]!;`,
    );
    const bad = run();
    expect(bad.code).toBe(1);
    expect(bad.output).toMatch(/基线 2 → 当前 3/);
    // --update 拒绝放宽
    const refuse = run(["--update"]);
    expect(refuse.code).toBe(1);
    expect(refuse.output).toMatch(/拒绝 --update/);
    // 下降到 1 处:通过、提示可 --update 收紧
    writeLibFile(
      "mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    const down = run();
    expect(down.code).toBe(0);
    expect(down.output).toMatch(/较基线 2 降 1/);
  });

  it("判据版本变了必须同步改脚本常数,否则 --update 拒绝", () => {
    writeLibFile(
      "mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    run(["--update"]);
    // 手改基线的 ruleVersion 到未来版本
    const p = join(workdir, "scripts", ".non-null-assertions-baseline.json");
    const json = JSON.parse(readFileSync(p, "utf8")) as { ruleVersion: number };
    json.ruleVersion = 999;
    writeFileSync(p, JSON.stringify(json, null, 2) + "\n", "utf8");
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/基线判据版本不一致/);
  });
});
