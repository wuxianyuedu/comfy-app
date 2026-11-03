/**
 * src 非空断言 `!` **硬闸**自检:把 `scripts/check-non-null-assertions.cjs`
 * 当黑盒跑在临时工作区上,验证它真能按 AST 认出 `NonNullExpression`、
 * 并**逐站点**放行已登记的合法形态（正则捕获组 / drizzle 判据构造）。
 *
 * 规范:docs/standards/13-提交与-code-review.md §13.5.6 与
 * docs/standards/18-lib层规范.md §18.6
 *
 * 为什么是硬闸:直接开 eslint `no-non-null-assertion` 一次报 160 处、评审全是噪声,
 * 所以本仓先以基线棘轮把存量清干净（ISSUE #1811 那批 160 → 0）,归零后翻成
 * 硬闸 —— 棘轮在 0 上只剩「手改 JSON 就能登记新违规」这条通道。
 * 合法例外走 `LEGIT_SITES` 逐条登记（唯一出口）,不是把判据调松。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-non-null-assertions.cjs",
  dirs: ["src"],
  /* 判据走 TS AST，要能解析 typescript —— 临时工作区旁边没有 node_modules。 */
  env: { NODE_PATH: join(process.cwd(), "node_modules") },
});

/** 工作区里现存的基线 JSON（递归找 `scripts/` 下 `*.json`）。 */
function globBaselines(root: string): Array<string> {
  const dir = join(root, "scripts");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

/** 在 `src/` 下写一个文件（判据跳过测试与 `.d.ts`，只扫生产代码）。 */
function writeSrcFile(repo: GateRepo, rel: string, body: string): void {
  repo.write(join("src", rel), body);
}

describe("check-non-null-assertions AST 判据", () => {
  test("认 arr[i]! 与 match[N]! 这两种 noUncheckedIndexedAccess 惯用法", ({ repo }) => {
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

  test("登记表只放行**登记过的**形状:换个变量名或组号照计", ({ repo }) => {
    /* 豁免若做成「凡是 `x[n]!` 就放过」,它立刻变成一块谁都能蹭的空地。
     * 这里在临时工作区里原样复刻 `LEGIT_SITES` 的一条登记（变量名 `m`、组号 `1`），
     * 再写一个**没登记**的版本 —— 后者必须被算进去。 */
    const scriptPath = "scripts/check-non-null-assertions.cjs";
    repo.write(
      scriptPath,
      repo.read(scriptPath).replace(
        "const LEGIT_SITES = new Map([",
        `const LEGIT_SITES = new Map([
  ["src/lib/legit.ts|m|1", "exec 第 1 组"],`,
      ),
    );
    writeSrcFile(
      repo,
      "lib/legit.ts",
      `export function grab(re: RegExp, s: string): string {
  const m = re.exec(s);
  const other = re.exec(s);
  return m && other ? m[1]! + other[2]! : "";
}`,
    );
    const r = repo.run(["--report"]);
    expect(r.code).toBe(0);
    // 登记的 `m[1]!` 免计；没登记的 `other[2]!` 照计
    expect(r.output).toMatch(/1 处/);
  });

  test("登记键是「文件 + 变量名 + 组下标」,行号漂移不失效力", ({ repo }) => {
    /* 行号做键的话,删掉上面几行注释就会让豁免静默失效 —— 也就等于没登记。
     * 这里把同一个函数往下垫 30 行,豁免照旧。 */
    repo.write(
      "scripts/check-non-null-assertions.cjs",
      repo.read("scripts/check-non-null-assertions.cjs").replace(
        "const LEGIT_SITES = new Map([",
        `const LEGIT_SITES = new Map([
  ["src/lib/padded.ts|m|1", "exec 第 1 组"],`,
      ),
    );
    writeSrcFile(
      repo,
      "lib/padded.ts",
      `${"\n".repeat(30)}export function grab(re: RegExp, s: string): string {
  const m = re.exec(s);
  return m ? m[1]! : "";
}`,
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

describe("check-non-null-assertions 硬闸", () => {
  test("存量已清零:一处 `!` 都不许有,命中即退 1", ({ repo }) => {
    const clean = repo.run();
    expect(clean.code).toBe(0);
    expect(clean.output).toMatch(/0 处/);

    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    const bad = repo.run();
    expect(bad.code).toBe(1);
    expect(bad.output).toMatch(/src\/lib\/mod\.ts: 1 处/);
  });

  test("`--update` 这个出口**已经不存在**：传了也照样按判定档判（断头用例）", ({ repo }) => {
    /* 翻硬闸时最容易漏的一件事:把 `--update` 的**分支**删了,却留着它的
     * **参数契约** —— 下一个人照旧跑 `--update` 以为能把违规登记成存量,
     * 而脚本默默按判定档退 1(或更糟:默默退 0)。这里正面钉住:
     * 传 `--update` 时既**不**落盘任何 JSON,也**不**放宽判定。 */
    writeSrcFile(
      repo,
      "lib/mod.ts",
      `const arr: (number | undefined)[] = [1];
export const a = arr[0]!;`,
    );
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(repo.exists("scripts/.non-null-assertions-baseline.json")).toBe(false);
    /* 全工作区一个基线文件都别出现（不是「换个名字写」）。 */
    expect(globBaselines(repo.dir)).toEqual([]);
  });
});
