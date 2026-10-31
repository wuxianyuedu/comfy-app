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
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-void-floats.cjs",
  dirs: ["src/lib"],
  /* 判据走 TS AST，要能解析 typescript —— 临时工作区旁边没有 node_modules，
   * 靠 NODE_PATH 指回源码仓库（脚本真的依赖这个输入，不是顺手给的口子）。 */
  env: { NODE_PATH: join(process.cwd(), "node_modules") },
});

/** 在 `src/lib/` 下写一个文件（判据只扫 lib 生产代码）。 */
function writeSrcFile(repo: GateRepo, rel: string, body: string): void {
  repo.write(join("src", "lib", rel), body);
}

describe("check-void-floats AST 判据", () => {
  test("认 `void fn();` 与 `void obj.fn();` 两种形态作为一条悬空", ({ repo }) => {
    writeSrcFile(
      repo,
      "a.ts",
      `async function fn(): Promise<void> {}
const obj = { async fn(): Promise<void> {} };
export async function go(): Promise<void> {
  void fn();
  void obj.fn();
}`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/2 处/);
    expect(r.output).toMatch(/src\/lib\/a\.ts/);
  });

  test("不误伤 `void someFn().catch(...)` 与 `await someFn()`——那些形态显式接管了 Promise", ({
    repo,
  }) => {
    writeSrcFile(
      repo,
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
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });

  test("跳过 .test.ts / __tests__ / .d.ts,只扫 lib 生产代码", ({ repo }) => {
    writeSrcFile(repo, "a.test.ts", `async function fn(): Promise<void> {} void fn();`);
    writeSrcFile(repo, "b.d.ts", `declare function fn(): void; void fn();`);
    repo.mkdir(join("src", "lib", "__tests__"));
    repo.write(
      join("src", "lib", "__tests__", "c.ts"),
      `async function fn(): Promise<void> {} void fn();`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });
});

describe("check-void-floats 棘轮", () => {
  test("--update 建立基线;此后同数量 OK、新增阻断、下降允许", ({ repo }) => {
    writeSrcFile(
      repo,
      "mod.ts",
      `async function a(): Promise<void> {}
async function b(): Promise<void> {}
a(); // 上面这行不匹配,只有下面两条命中
void a();
void b();`,
    );
    // 无基线:提示先 --update
    const first = repo.run();
    expect(first.code).toBe(0);
    expect(first.output).toMatch(/基线未建立/);
    // 建立基线
    const upd = repo.run(["--update"]);
    expect(upd.code).toBe(0);
    const baseline = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(join(repo.dir, "scripts", ".void-floats-baseline.json"), "utf8"),
    ) as { files: Record<string, number>; ruleVersion: number; total: number; };
    expect(baseline.total).toBe(2);
    expect(baseline.files["src/lib/mod.ts"]).toBe(2);
    // 同数量:OK
    const ok = repo.run();
    expect(ok.code).toBe(0);
    expect(ok.output).toMatch(/OK/);
    // 新增第三处:阻断
    writeSrcFile(
      repo,
      "mod.ts",
      `async function a(): Promise<void> {}
async function b(): Promise<void> {}
async function c(): Promise<void> {}
void a();
void b();
void c();`,
    );
    const bad = repo.run();
    expect(bad.code).toBe(1);
    expect(bad.output).toMatch(/基线 2 → 当前 3/);
    expect(bad.output).toMatch(/fireAndForget/);
    // --update 拒绝放宽
    const refuse = repo.run(["--update"]);
    expect(refuse.code).toBe(1);
    expect(refuse.output).toMatch(/拒绝 --update/);
    // 下降到 1 处:非 strict 只提示、strict 阻断
    writeSrcFile(
      repo,
      "mod.ts",
      `async function a(): Promise<void> {}
void a();`,
    );
    const down = repo.run();
    expect(down.code).toBe(0);
    expect(down.output).toMatch(/检测到.*下降/);
    const downStrict = repo.run(["--strict"]);
    expect(downStrict.code).toBe(1);
    expect(downStrict.output).toMatch(/收紧基线/);
  });

  test("判据版本变了必须同步改脚本常数,否则 --update 拒绝", ({ repo }) => {
    writeSrcFile(
      repo,
      "mod.ts",
      `async function a(): Promise<void> {}
void a();`,
    );
    repo.run(["--update"]);
    const p = join(repo.dir, "scripts", ".void-floats-baseline.json");
    const json = /* SAFETY: 类型断言已复核 */ JSON.parse(readFileSync(p, "utf8")) as {
      ruleVersion: number;
    };
    json.ruleVersion = 999;
    writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/基线判据版本不一致/);
  });
});
