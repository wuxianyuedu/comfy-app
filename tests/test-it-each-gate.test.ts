/**
 * 「参数化用例 `it.for` ⇄ `it.each`」门禁自测（规范 §11.15）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-it-each.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `it.each(...)`，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts` 的取舍）。
 *
 * 逐条钉判定口径（本判据是**硬闸**：无基线、无 `--update`）：
 *   ① `it.each` / `describe.each` 都是站点（按名字收窄会漏）→ 该拦
 *   ② 一处都没有 → 放行
 *   ③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看
 *   ④ 夹具字符串 / 注释里的 `.each(` → 不算站点
 *   ⑤ 判据自己的夹具文件 → 跳过
 *   ⑥ 翻闸后无基线文件可读：`--update` 走的是「未知参数」旧路，不写任何 JSON
 *
 * ## 为什么这份改用了共享夹具（ISSUE #2405）
 *
 * 过去它自己写 `gate()`：`execFileSync` 包 `try/catch`，把结果折成
 * `{ ok: boolean, output, root }`。那个 `ok` 判的是「子进程有没有抛」，于是
 * 「判据判出违规」与「判据**根本没跑起来**」在账面上逐字同形 —— 而后者的退出码
 * 也是 1（node 报 `Cannot find module`）。`expect(r.ok).toBe(false)` 在第二类上
 * **照样绿**。现场（ISSUE #2405）：PR #2404 的 `受影响用例` 那一格红成
 * `expected false to be true`（就是下面 ②′ 这一格），而同两个文件本地复算
 * `Tests 10 passed (10)` —— **那一跑究竟属于哪一类，当时没有读数可以分辨**，
 * 本文件改到这个形状要买的就是「下一次能分辨」，不是「那一次已经查清」。
 * 现在 `ran / status / spawnError / signal` 由 `helpers/gate-repo` 一处交出，
 * 每条断言前先 `expectGateRan(r)`（口径同 §13.6.4「拿不到测量 ≠ 测量结果是红的」）；
 * 依赖补齐归 `copyGateDeps`，本文件不再手写 `DEP`。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineGateRepo, describe, expectGateRan } from "./helpers/gate-repo";

const SCRIPT_REL = "scripts/check-test-it-each.cjs";
const SCRIPT = path.resolve(__dirname, "..", SCRIPT_REL);

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
const { scanFile } = /* SAFETY: 类型断言已复核 */ createRequire(import.meta.url)(SCRIPT) as {
  scanFile: (abs: string) => Array<unknown> | null;
};

const { test, expect } = defineGateRepo({
  script: "check-test-it-each.cjs",
  dirs: ["src"],
  workdir: "test-it-each",
});

const VITEST = 'import { describe, expect, it } from "vitest";\n';

describe("it.each 门禁：该拦的形状（§11.15）", () => {
  test("① `it.each` 是站点 → 阻断，并点名站点与章节", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${VITEST}it.each([[1, "a"]])("%s %s", (n, s) => {
  expect(n).toBe(1);
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("还有 1 处 `it.each`");
    expect(r.output).toContain("src/a.test.ts");
    expect(r.output).toContain("§11.15");
  });

  test("①′ `describe.each` 同样是站点（按名字收窄会漏）", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${VITEST}describe.each([["x"]])("%s", (v) => {
  it("t", () => expect(v).toBe("x"));
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("还有 1 处 `it.each`");
  });

  test("①″ `test.each` 同样是站点", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `import { expect, test } from "vitest";
test.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("还有 1 处 `it.each`");
  });
});

describe("it.each 门禁：该放的形状（§11.15）", () => {
  test("② 一处 `it.each` 都没有 → 放行", ({ repo }) => {
    repo.write("src/a.test.ts", `${VITEST}it("x", () => {});\n`);
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("OK");
  });

  test("②′ 翻闸前遗留的基线文件不影响判定（硬闸只看站点数是否为 0）", ({ repo }) => {
    repo.write("src/a.test.ts", `${VITEST}it("x", () => {});\n`);
    /* 基线在 ②′ 这里是被测输入之一：它**在场**（旧棘轮时代的文件没删干净），
     * 而判定不许因为它而改变。 */
    repo.write(
      "scripts/.test-it-each-baseline.json",
      JSON.stringify({ total: 2, files: { "src/a.test.ts": 2 } }),
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("OK");
  });

  test("③ 本地同名 helper（不是 vitest 导入的）→ 整文件不看", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `function it(_a: unknown, _b: unknown) {
  return undefined as never;
}
it.each([[1]])("x", () => {});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("OK");
  });

  test("④ 夹具字符串与注释里的 `.each(` → 不算站点（maskNonCode）", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${VITEST}const FIXTURE = \`it.each([[1]])\`;
it("夹具字符串不算站点", () => {
  // describe.each 写在注释里也不算
  expect(FIXTURE).toContain("each");
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("OK");
  });

  test("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", ({ repo }) => {
    repo.write(
      "tests/test-it-each-gate.test.ts",
      `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("OK");
  });
});

describe("it.each 门禁：翻闸后不再有收紧档（§11.15）", () => {
  test("⑥ 无基线文件可写：带 `--update` 也不落盘任何 JSON", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${VITEST}it.each([[1]])("%s", (n) => expect(n).toBe(1));
`,
    );
    const r = repo.run(["--update"]);
    expectGateRan(r);
    /* 硬闸只认「站点数是否为 0」：`--update` 已不是本判据的出口，
     *  于是它退的是「有站点」那条 1，且**不写任何基线**（那条后门已封）。 */
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("还有 1 处 `it.each`");
    expect(repo.exists("scripts/.test-it-each-baseline.json")).toBe(false);
  });
});

describe("it.each 门禁：扫描期间文件消失（并发探针）", () => {
  test("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造
       `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉。同一份工作树里有两个
       vitest 在跑时（并行会话，或本钩子的 C 组还没退干净），本判据就会
       **「列到名字、读时已经没了」** —— 于是 D 组不是报出站点，而是带着一个
       Node 栈崩掉（`ENOENT … .setup-cleanup-probe-….test.tsx`），表现成
       「提交被拦下、报错里没有一个字指向改动」。
       一个已经不存在的文件没有站点可言 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished` 与 OK 那行的「另有 N 份未读」），
       静默跳过就是 §13.5.12 那一族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(__dirname, "..", "tests", `.setup-cleanup-probe-0-0.test.tsx`);
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
