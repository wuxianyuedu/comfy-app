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
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-non-null-assertions.cjs",
  dirs: ["src"],
  /* 判据走 TS AST，要能解析 typescript —— 临时工作区旁边没有 node_modules。 */
  env: { NODE_PATH: join(process.cwd(), "node_modules") },
});

/** 在 `src/` 下写一个文件（判据跳过测试与 `.d.ts`，只扫生产代码）。 */
function writeSrcFile(repo: GateRepo, rel: string, body: string): void {
  repo.write(join("src", rel), body);
}

describe("check-non-null-assertions AST 判据", () => {
  test("认 arr[i]! 与 match[N]! 这两种 noUncheckedIndexedAccess 惯用法", ({
    repo,
  }) => {
    writeSrcFile(
      repo,
      "lib/sample.ts",
      `function pick(arr: string[], i: number): string { return arr[i]!; }
function grab(re: RegExp, s: string): string { const m = re.exec(s); return m ? m[1]! : ""; }
export { pick, grab };`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/总数 2|total 2|2 处/);
  });

  test("不误伤 !== / !x / 行注释与块注释里的裸 `!`", ({ repo }) => {
    writeSrcFile(
      repo,
      "lib/clean.ts",
      `// 这里 ! 只在注释里! 举例
/* 块注释也不该被算! */
export function ok(a: string | null): boolean {
  if (a !== null && !a) return true;   // !== 与 !a 都不是 NonNullExpression
  return false;
}
`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });

  test("跳过 .test.ts / __tests__ / .d.ts,只扫 src 生产代码", ({ repo }) => {
    writeSrcFile(
      repo,
      "lib/a.test.ts",
      `const x = [1] as (number | undefined)[]; expect(x[0]!).toBe(1);`,
    );
    writeSrcFile(
      repo,
      "lib/b.d.ts",
      `declare const v: { n?: number }; export declare const w: number; void (v.n!);`,
    );
    repo.mkdir("src/lib/__tests__");
    repo.write(
      "src/lib/__tests__/c.ts",
      `const arr = [1] as (number | undefined)[]; export const x = arr[0]!;`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0 处/);
  });

  test("v2 起扫描覆盖到 src/components / src/app / src/server(视图与服务端不再是盲区)", ({
    repo,
  }) => {
    writeSrcFile(
      repo,
      "components/one.ts",
      `const a: (string | undefined)[] = ["x"]; export const v = a[0]!;`,
    );
    writeSrcFile(
      repo,
      "app/api/route.ts",
      `const b: (number | undefined)[] = [1]; export const w = b[0]!;`,
    );
    writeSrcFile(
      repo,
      "server/svc.ts",
      `const c: (boolean | undefined)[] = [true]; export const z = c[0]!;`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    // 三处 `!` 分布在三个新盲区里,都要被看见
    expect(r.output).toMatch(/3 处/);
    expect(r.output).toMatch(/src\/components\/one\.ts/);
    expect(r.output).toMatch(/src\/app\/api\/route\.ts/);
    expect(r.output).toMatch(/src\/server\/svc\.ts/);
  });
});

describe("check-non-null-assertions 棘轮", () => {
  test("--update 建立基线;此后同数量 OK、新增阻断、下降允许", ({ repo }) => {
    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;
export const b = arr[0]!;`,
    );
    // 无基线:提示先 --update
    const first = repo.run();
    expect(first.code).toBe(0);
    expect(first.output).toMatch(/基线未建立/);
    // 建立基线
    const upd = repo.run(["--update"]);
    expect(upd.code).toBe(0);
    const baseline = JSON.parse(
      repo.read("scripts/.non-null-assertions-baseline.json"),
    ) as { ruleVersion: number; total: number; files: Record<string, number> };
    expect(baseline.total).toBe(2);
    expect(baseline.files["src/lib/mod.ts"]).toBe(2);
    // 同数量:OK
    const ok = repo.run();
    expect(ok.code).toBe(0);
    expect(ok.output).toMatch(/OK/);
    // 新增第三处:阻断
    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;
export const b = arr[0]!;
export const c = arr[0]!;`,
    );
    const bad = repo.run();
    expect(bad.code).toBe(1);
    expect(bad.output).toMatch(/基线 2 → 当前 3/);
    // --update 拒绝放宽
    const refuse = repo.run(["--update"]);
    expect(refuse.code).toBe(1);
    expect(refuse.output).toMatch(/拒绝 --update/);
    // 下降到 1 处:通过、提示可 --update 收紧
    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    const down = repo.run();
    expect(down.code).toBe(0);
    expect(down.output).toMatch(/较基线 2 降 1/);
  });

  test("判据版本变了必须同步改脚本常数,否则 --update 拒绝", ({ repo }) => {
    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    repo.run(["--update"]);
    // 手改基线的 ruleVersion 到未来版本
    const baselinePath = "scripts/.non-null-assertions-baseline.json";
    const json = JSON.parse(repo.read(baselinePath)) as { ruleVersion: number };
    json.ruleVersion = 999;
    repo.write(baselinePath, JSON.stringify(json, null, 2) + "\n");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/基线判据版本不一致/);
  });
});
