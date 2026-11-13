/**
 * 「参数化用例 `it.for` ⇄ `it.each`」门禁自测（§11.15）；本文件不进扫描面（`FIXTURE_SKIP`，被测串含真 `it.each`）。
 * 硬闸口径（无基线）：`it.each`/`describe.each` 是站点、无站点放行、本地同名 helper 整文件不看、夹具与注释不算、
 * 夹具文件跳过。共享夹具（#2405）：旧 `ok` 把「判出违规」与「没跑起来」（同样退 1）混同，现断言前先 `expectGateRan`（§13.6.4）。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isRecord } from "~/lib/is-record";

import { defineGateRepo, describe, expectGateRan } from "./helpers/gate-repo";

const SCRIPT_REL = "scripts/check-test-it-each.cjs";
const SCRIPT = path.resolve(__dirname, "..", SCRIPT_REL);

/** 判据模块的消费形状守卫（B5 清账）：只取 scanFile 一件。 */
function isScanModule(
  value: unknown,
): value is { scanFile: (abs: string) => Array<unknown> | null } {
  return isRecord(value) && typeof value.scanFile === "function";
}

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
const scanModule: unknown = createRequire(import.meta.url)(SCRIPT);
if (!isScanModule(scanModule)) {
  throw new Error("check-test-it-each.cjs 缺 scanFile —— 判据脚本形状变了");
}
const { scanFile } = scanModule;

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
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造 `.setup-cleanup-probe-*.test.tsx` 再删掉；
       同工作树两个 vitest 并发时（并行会话或 C 组未退干净），本判据会「列到名字、读时已没了」—— D 组带着
       `ENOENT` 栈崩掉，报错里没有一个字指向改动。已不存在的文件没有站点 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished`、OK 行的「另有 N 份未读」），
       静默跳过即 §13.5.12 那族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(__dirname, "..", "tests", `.setup-cleanup-probe-0-0.test.tsx`);
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
