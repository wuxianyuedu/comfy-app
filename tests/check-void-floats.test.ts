/**
 * src/lib `void someFn(...)` 语句棘轮自检:把 `scripts/check-void-floats.cjs`
 * 当黑盒跑在临时工作区上,验证 AST 判据、基线读写与「只挡新增、允许下降」的
 * 棘轮语义。
 *
 * 规范:docs/standards/13-提交与-code-review.md §13.5.7
 *      docs/standards/18-lib层规范.md
 *
 * 为什么值得有门禁:PR-4b 加了 `fireAndForget` 地基、PR-10 逐个审了 lib 里
 * 30+ 处 `void fn()` 把 10 处真漏改走 fireAndForget;但**人工审计会漂**——
 * 下一位开发者写下 `void persistLogs(taskId)`(若被调方没有内部 catch)就是一颗
 * 未来的 unhandledRejection,pre-commit 不会响。这条判据**强制显式**:
 * 写下 `void someFn()` 这个形态本身要走一次评审,要么改用 fireAndForget,
 * 要么 `--update` 收紧基线时说明「被调方内部已 catch、这里是刻意悬空」。
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

const SCRIPT = join(process.cwd(), "scripts", "check-void-floats.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-void-floats.cjs"), ...args],
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

function writeSrcFile(rel: string, body: string): void {
  const abs = join(workdir, "src", "lib", rel);
  mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "void-floats-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-void-floats.cjs"));
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-void-floats AST 判据", () => {
  it("认 `void fn();` 与 `void obj.fn();` 两种形态作为一条悬空", () => {
    writeSrcFile(
      "a.ts",
      `async function fn(): Promise<void> {}
const obj = { async fn(): Promise<void> {} };
export async function go(): Promise<void> {
  void fn();
  void obj.fn();
}`,
    );
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/2 处/);
    expect(r.output).toMatch(/src\/lib\/a\.ts/);
  });

  it("不误伤 `void someFn().catch(...)` 与 `await someFn()`——那些形态显式接管了 Promise", () => {
    writeSrcFile(
      "b.ts",
      `async function fn(): Promise<void> {}
export async function go(): Promise<void> {
  void fn().catch(() => {});
  await fn();
}`,
    );
    // 第一条 `void fn().catch(...)`: UnaryExpression(void) 的 operation 是
    // CallExpression().catch(...) 而不是 fn()——所以不匹配本判据。
    // 第二条 await: 完全另一种 AST 形态。
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });

  it("跳过 .test.ts / __tests__ / .d.ts,只扫 lib 生产代码", () => {
    writeSrcFile(
      "a.test.ts",
      `async function fn(): Promise<void> {} void fn();`,
    );
    writeSrcFile("b.d.ts", `declare function fn(): void; void fn();`);
    mkdirSync(join(workdir, "src", "lib", "__tests__"), { recursive: true });
    writeFileSync(
      join(workdir, "src", "lib", "__tests__", "c.ts"),
      `async function fn(): Promise<void> {} void fn();`,
      "utf8",
    );
    const r = run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });
});

describe("check-void-floats 棘轮", () => {
  it("--update 建立基线;此后同数量 OK、新增阻断、下降允许", () => {
    writeSrcFile(
      "mod.ts",
      `async function a(): Promise<void> {}
async function b(): Promise<void> {}
a(); // 上面这行不匹配,只有下面两条命中
void a();
void b();`,
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
        join(workdir, "scripts", ".void-floats-baseline.json"),
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
    writeSrcFile(
      "mod.ts",
      `async function a(): Promise<void> {}
async function b(): Promise<void> {}
async function c(): Promise<void> {}
void a();
void b();
void c();`,
    );
    const bad = run();
    expect(bad.code).toBe(1);
    expect(bad.output).toMatch(/基线 2 → 当前 3/);
    expect(bad.output).toMatch(/fireAndForget/);
    // --update 拒绝放宽
    const refuse = run(["--update"]);
    expect(refuse.code).toBe(1);
    expect(refuse.output).toMatch(/拒绝 --update/);
    // 下降到 1 处:非 strict 只提示、strict 阻断
    writeSrcFile(
      "mod.ts",
      `async function a(): Promise<void> {}
void a();`,
    );
    const down = run();
    expect(down.code).toBe(0);
    expect(down.output).toMatch(/检测到.*下降/);
    const downStrict = run(["--strict"]);
    expect(downStrict.code).toBe(1);
    expect(downStrict.output).toMatch(/收紧基线/);
  });

  it("判据版本变了必须同步改脚本常数,否则 --update 拒绝", () => {
    writeSrcFile(
      "mod.ts",
      `async function a(): Promise<void> {}
void a();`,
    );
    run(["--update"]);
    const p = join(workdir, "scripts", ".void-floats-baseline.json");
    const json = JSON.parse(readFileSync(p, "utf8")) as { ruleVersion: number };
    json.ruleVersion = 999;
    writeFileSync(p, JSON.stringify(json, null, 2) + "\n", "utf8");
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/基线判据版本不一致/);
  });
});
