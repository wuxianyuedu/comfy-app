/**
 * 函数长度门禁自检：把 `scripts/check-function-length.cjs` 当黑盒跑在临时
 * 工作区上，验证它真能认出「超长函数」并**阻断**（硬闸）。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.13
 *
 * 为什么值得有门禁：文件行数有 R5 守着，**函数**没有 —— 于是 2186 行的单函数
 * （`settings/SettingsPageView.tsx` 的 `SettingsPageView`）一路合法存在，任何
 * 改动都要先在这两千行里定位，而「能不能拆」没有任何机器信号。
 *
 * ISSUE #570 第 7 项补齐了另一半：无名字的块体（IIFE / 回调 / 闭包）**同受约束**
 * —— 否则「把 300 行塞进 IIFE 里」能整条绕过本门禁，而这正是本仓库真实发生过
 * 的事（`lifecycle.ts` 的 `ensureComfyUiReady` 里挂了一个 288 行 IIFE 与三个
 * 40 行事件回调）。见下方「匿名块体」一组用例。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-function-length.cjs",
  dirs: ["src"],
});

/** 造一个函数体 `bodyLines` 行的模块。 */
function writeFunction(
  repo: GateRepo,
  rel: string,
  name: string,
  bodyLines: number,
  opts: { asConst?: boolean; async?: boolean; } = {},
): string {
  const body = Array.from(
    { length: bodyLines },
    (_, i) => `  const v${i} = ${i};`,
  ).join("\n");
  const kw = opts.async ? "export async function" : "export function";
  const decl = opts.asConst
    ? `export const ${name} = (x: number) => {`
    : `${kw} ${name}(x: number) {`;
  const src = `${decl}\n${body}\n  return x;\n}\n`;
  repo.write(rel, src);
  return src;
}

describe("check-function-length.cjs（函数长度门禁）", () => {
  test("小函数放行（硬闸不需要任何基线）", ({ repo }) => {
    writeFunction(repo, "src/a.ts", "short", 5);
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("超过 400 行的函数 0 个");
  });

  test("超阈值函数进拆分候选清单（--report 列名字与行号）", ({ repo }) => {
    writeFunction(repo, "src/big.ts", "huge", 450);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("src/big.ts:1");
    expect(output).toContain("huge");
    expect(output).toContain("453 行");
  });

  test("小函数不进清单（阈值防噪音）", ({ repo }) => {
    writeFunction(repo, "src/small.ts", "tiny", 20);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("[ok] 函数长度");
  });

  test("任何巨型函数都阻断（无「已登记的存量」这一档）", ({ repo }) => {
    writeFunction(repo, "src/ok.ts", "fine", 20);
    writeFunction(repo, "src/new.ts", "grew", 500);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("巨型函数");
    expect(output).toContain("src/new.ts");
  });

  test("同一文件里第二个巨型函数也阻断", ({ repo }) => {
    writeFunction(repo, "src/one.ts", "first", 450);
    const src = repo.read("src/one.ts");
    repo.write("src/one.ts", src + writeFunctionBody("second", 450));
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/one.ts");
  });

  /* 硬闸：没有基线、也没有 --update 通道 —— 巨型函数的存量已清零后，棘轮那两层
   * （基线文件 + 收紧）只剩开销，还留了一个「手改基线把新巨型函数登记成已知存量」
   * 的口子。这条钉住「退出通道真的没了」。 */
  test("硬闸：--update 不写任何基线文件", ({ repo }) => {
    writeFunction(repo, "src/big.ts", "huge", 450);
    repo.run(["--update"]);
    expect(
      existsSync(join(repo.dir, "scripts", ".function-length-baseline.json")),
    ).toBe(false);
  });

  test("测试文件不扫（用例之间雷同、个别用例长是正常的）", ({ repo }) => {
    writeFunction(repo, "src/big.test.ts", "hugeCase", 500);
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  test("字符串与模板里的括号不参与配对（否则函数尾会找错）", ({ repo }) => {
    const rel = "src/strings.ts";
    /* 每行都塞进不平衡的括号（放在字符串与模板里）—— 若脚本按字符流硬数
     * 括号，函数尾会找错，这个用例就会漏报。 */
    const body = Array.from(
      { length: 450 },
      (_, i) => "  const s" + i + ' = "} { ) ( " + String(' + i + ") + ' ) }';",
    ).join("\n");
    repo.write(
      rel,
      "export function braces(x: number) {\n" + body + "\n  return x;\n}\n",
    );
    const { output } = repo.run(["--report"]);
    // 括号在字符串里被忽略 → 仍应认出这个函数
    expect(output).toContain("src/strings.ts:1");
    expect(output).toContain("braces");
  });

  test("同文件里有小函数混着时，只报超阈值的那个", ({ repo }) => {
    const rel = "src/mixed.ts";
    repo.write(
      rel,
      `export function small(x: number) {\n  return x;\n}\n\n` +
        `export function bigFn(x: number) {\n${Array.from({ length: 450 }, (_, i) => `  const v${i} = ${i};`).join("\n")}\n  return x;\n}\n`,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("bigFn");
    expect(output).not.toContain("  small");
  });
});

describe("匿名块体（IIFE / 回调 / 闭包）同受约束（ISSUE #570 第 7 项）", () => {
  /** 造一个含「匿名块体」的模块：外层具名函数只占 `outerBody` 行，
   *  超长的那段挂在 `head` 打开的匿名块体里。 */
  function writeAnonymous(
    repo: GateRepo,
    rel: string,
    head: string,
    bodyLines: number,
    outerBody = 5,
  ): void {
    const body = Array.from(
      { length: bodyLines },
      (_, i) => `    const v${i} = ${i};`,
    ).join("\n");
    const outer = Array.from(
      { length: outerBody },
      (_, i) => `  const o${i} = ${i};`,
    ).join("\n");
    repo.write(
      rel,
      `export function outer(x: number) {\n${outer}\n${head}\n${body}\n  });\n  return x;\n}\n`,
    );
  }

  test("模块级 IIFE 超阈值 → 认出（否则「塞进 IIFE」= 绕过门禁）", ({
    repo,
  }) => {
    const rel = "src/mod-iife.ts";
    const body = Array.from(
      { length: 450 },
      (_, i) => `  const v${i} = ${i};`,
    ).join("\n");
    repo.write(rel, `(() => {\n${body}\n})();\n`);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("src/mod-iife.ts:1");
    expect(output).toContain("(匿名块体)");
  });

  test("具名函数里的 IIFE 超阈值 → 外层与匿名两条都报", ({ repo }) => {
    writeAnonymous(
      repo,
      "src/inner-iife.ts",
      "  st.starting = (async () => {",
      430,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("outer");
    expect(output).toContain("(匿名块体)");
  });

  test('回调体（`on("data", (d) => { … })`）超阈值 → 认出', ({ repo }) => {
    writeAnonymous(
      repo,
      "src/callback.ts",
      '  child.on("data", (d: string) => {',
      430,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("(匿名块体)");
  });

  test("`cacheJson(k, ttl, async () => { … })` 这类闭包参数 → 认出", ({
    repo,
  }) => {
    writeAnonymous(
      repo,
      "src/closure-arg.ts",
      "  const p = cacheJson(k, 30_000, async () => {",
      430,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("(匿名块体)");
  });

  test("巨型匿名块体同样阻断（塞进 IIFE 不能绕过门禁）", ({ repo }) => {
    writeFunction(repo, "src/ok.ts", "fine", 20);
    writeAnonymous(repo, "src/grew.ts", "  queue(() => {", 450);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/grew.ts");
    expect(output).toContain("(匿名块体)");
  });

  test("大对象字面量不被误认成函数体（没有 `=>` / `function`）", ({ repo }) => {
    const rel = "src/object.ts";
    const body = Array.from({ length: 450 }, (_, i) => `  key${i}: ${i},`).join(
      "\n",
    );
    repo.write(rel, `export const CONFIG = {\n${body}\n};\n`);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("[ok] 函数长度");
  });

  test("注释与模板字符串里的 `() => {` 不算函数体", ({ repo }) => {
    const rel = "src/in-strings.ts";
    const lines = [
      "export function f(x: number) {",
      "  /* 注释里的 () => {  不该被认成函数体 */",
      "  const s = `模板里的 () => { 也不算`;",
      ...Array.from({ length: 450 }, (_, i) => `  const v${i} = ${i};`),
      "  return x;",
      "}",
    ];
    repo.write(rel, lines.join("\n"));
    const { output } = repo.run(["--report"]);
    // 只应报具名的 f 一条，没人被注释/字符串里那两处误导成匿名块体
    expect(output).toContain("  f");
    expect(output).not.toContain("(匿名块体)");
  });
});

/** 追加用的第二段函数体（与 writeFunction 同形，不写文件）。 */
function writeFunctionBody(name: string, bodyLines: number): string {
  const body = Array.from(
    { length: bodyLines },
    (_, i) => `  const w${i} = ${i};`,
  ).join("\n");
  return `\nexport function ${name}(x: number) {\n${body}\n  return x;\n}\n`;
}
