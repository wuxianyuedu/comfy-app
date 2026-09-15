/**
 * 函数长度门禁自检：把 `scripts/check-function-length.cjs` 当黑盒跑在临时
 * 工作区上，验证它真能认出「超长函数」并按棘轮记账。
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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-function-length.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-function-length.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
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

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "function-length-gate-"));
  /* 脚本用 `__dirname/..` 定扫描根（与其它门禁脚本同一约定），所以要落在
   * 工作区的 scripts/ 下。 */
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-function-length.cjs"));
  mkdirSync(join(workdir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 造一个函数体 `bodyLines` 行的模块。 */
function writeFunction(
  rel: string,
  name: string,
  bodyLines: number,
  opts: { async?: boolean; asConst?: boolean } = {},
): string {
  const abs = join(workdir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  const body = Array.from({ length: bodyLines }, (_, i) => `  const v${i} = ${i};`).join("\n");
  const kw = opts.async ? "export async function" : "export function";
  const decl = opts.asConst
    ? `export const ${name} = (x: number) => {`
    : `${kw} ${name}(x: number) {`;
  const src = `${decl}\n${body}\n  return x;\n}\n`;
  writeFileSync(abs, src);
  return src;
}

describe("check-function-length.cjs（函数长度门禁）", () => {
  it("基线文件缺失时阻断（先要求建基线）", () => {
    writeFunction("src/a.ts", "short", 5);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  it("超阈值函数进拆分候选清单（--report 列名字与行号）", () => {
    writeFunction("src/big.ts", "huge", 450);
    const { output } = run(["--report"]);
    expect(output).toContain("src/big.ts:1");
    expect(output).toContain("huge");
    expect(output).toContain("453 行");
  });

  it("小函数不进清单（阈值防噪音）", () => {
    writeFunction("src/small.ts", "tiny", 20);
    const { output } = run(["--report"]);
    expect(output).toContain("（无）");
  });

  it("基线外新增巨型函数阻断", () => {
    writeFunction("src/ok.ts", "fine", 20);
    run(["--update"]);
    writeFunction("src/new.ts", "grew", 500);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线外新增巨型函数");
    expect(output).toContain("src/new.ts");
  });

  it("同一文件里再长出第二个巨型函数也算上升（按文件计数）", () => {
    writeFunction("src/one.ts", "first", 450);
    run(["--update"]);
    const src = readFileSync(join(workdir, "src/one.ts"), "utf8");
    writeFileSync(
      join(workdir, "src/one.ts"),
      src + writeFunctionBody("second", 450),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/one.ts");
  });

  it("治理后（巨型函数被拆掉）未收紧基线：--strict 失败，非 strict 只提示", () => {
    writeFunction("src/big.ts", "huge", 450);
    run(["--update"]);
    writeFunction("src/big.ts", "huge", 30); // 拆小了
    expect(run(["--strict"]).code).toBe(1);
    const relaxed = run();
    expect(relaxed.code).toBe(0);
    expect(relaxed.output).toContain("巨型函数已减少");
  });

  it("测试文件不扫（用例之间雷同、个别用例长是正常的）", () => {
    writeFunction("src/big.test.ts", "hugeCase", 500);
    run(["--update"]);
    const { code } = run();
    expect(code).toBe(0);
  });

  it("字符串与模板里的括号不参与配对（否则函数尾会找错）", () => {
    const abs = join(workdir, "src", "strings.ts");
    /* 每行都塞进不平衡的括号（放在字符串与模板里）—— 若脚本按字符流硬数
     * 括号，函数尾会找错，这个用例就会漏报。 */
    const body = Array.from(
      { length: 450 },
      (_, i) =>
        '  const s' +
        i +
        ' = "} { ) ( " + String(' +
        i +
        ") + ' ) }';",
    ).join("\n");
    writeFileSync(abs, "export function braces(x: number) {\n" + body + "\n  return x;\n}\n");
    const { output } = run(["--report"]);
    // 括号在字符串里被忽略 → 仍应认出这个函数
    expect(output).toContain("src/strings.ts:1");
    expect(output).toContain("braces");
  });

  it("同文件里有小函数混着时，只报超阈值的那个", () => {
    const abs = join(workdir, "src", "mixed.ts");
    writeFileSync(
      abs,
      `export function small(x: number) {\n  return x;\n}\n\n` +
        `export function bigFn(x: number) {\n${Array.from({ length: 450 }, (_, i) => `  const v${i} = ${i};`).join("\n")}\n  return x;\n}\n`,
    );
    const { output } = run(["--report"]);
    expect(output).toContain("bigFn");
    expect(output).not.toContain("  small");
  });
});

describe("匿名块体（IIFE / 回调 / 闭包）同受约束（ISSUE #570 第 7 项）", () => {
  /** 造一个含「匿名块体」的模块：外层具名函数只占 `outerBody` 行，
   *  超长的那段挂在 `head` 打开的匿名块体里。 */
  function writeAnonymous(
    rel: string,
    head: string,
    bodyLines: number,
    outerBody = 5,
  ): void {
    const abs = join(workdir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    const body = Array.from({ length: bodyLines }, (_, i) => `    const v${i} = ${i};`).join("\n");
    const outer = Array.from({ length: outerBody }, (_, i) => `  const o${i} = ${i};`).join("\n");
    writeFileSync(
      abs,
      `export function outer(x: number) {\n${outer}\n${head}\n${body}\n  });\n  return x;\n}\n`,
    );
  }

  it("模块级 IIFE 超阈值 → 认出（否则「塞进 IIFE」= 绕过门禁）", () => {
    const abs = join(workdir, "src", "mod-iife.ts");
    const body = Array.from({ length: 450 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    writeFileSync(abs, `(() => {\n${body}\n})();\n`);
    const { output } = run(["--report"]);
    expect(output).toContain("src/mod-iife.ts:1");
    expect(output).toContain("(匿名块体)");
  });

  it("具名函数里的 IIFE 超阈值 → 外层与匿名两条都报", () => {
    writeAnonymous("src/inner-iife.ts", '  st.starting = (async () => {', 430);
    const { output } = run(["--report"]);
    expect(output).toContain("outer");
    expect(output).toContain("(匿名块体)");
  });

  it("回调体（`on(\"data\", (d) => { … })`）超阈值 → 认出", () => {
    writeAnonymous("src/callback.ts", '  child.on("data", (d: string) => {', 430);
    const { output } = run(["--report"]);
    expect(output).toContain("(匿名块体)");
  });

  it("`cacheJson(k, ttl, async () => { … })` 这类闭包参数 → 认出", () => {
    writeAnonymous("src/closure-arg.ts", "  const p = cacheJson(k, 30_000, async () => {", 430);
    const { output } = run(["--report"]);
    expect(output).toContain("(匿名块体)");
  });

  it("新增巨型匿名块体在棘轮上算上升（基线外即阻断）", () => {
    writeFunction("src/ok.ts", "fine", 20);
    run(["--update"]);
    writeAnonymous("src/grew.ts", '  queue(() => {', 450);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/grew.ts");
    expect(output).toContain("(匿名块体)");
  });

  it("大对象字面量不被误认成函数体（没有 `=>` / `function`）", () => {
    const abs = join(workdir, "src", "object.ts");
    const body = Array.from({ length: 450 }, (_, i) => `  key${i}: ${i},`).join("\n");
    writeFileSync(abs, `export const CONFIG = {\n${body}\n};\n`);
    const { output } = run(["--report"]);
    expect(output).toContain("（无）");
  });

  it("注释与模板字符串里的 `() => {` 不算函数体", () => {
    const abs = join(workdir, "src", "in-strings.ts");
    const lines = [
      "export function f(x: number) {",
      "  /* 注释里的 () => {  不该被认成函数体 */",
      "  const s = `模板里的 () => { 也不算`;",
      ...Array.from({ length: 450 }, (_, i) => `  const v${i} = ${i};`),
      "  return x;",
      "}",
    ];
    writeFileSync(abs, lines.join("\n"));
    const { output } = run(["--report"]);
    // 只应报具名的 f 一条，没人被注释/字符串里那两处误导成匿名块体
    expect(output).toContain("  f");
    expect(output).not.toContain("(匿名块体)");
  });
});

describe("判据版本（基线不许被静默放宽）", () => {
  /** 直接改写临时工作区的基线文件：模拟「基线来自旧判据」。 */
  function rewriteBaseline(patch: Record<string, unknown>): void {
    const p = join(workdir, "scripts", ".function-length-baseline.json");
    const data = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    writeFileSync(p, JSON.stringify({ ...data, ...patch }, null, 2));
  }

  it("基线判据版本与脚本不一致 → 阻断并给出 --update 指引", () => {
    writeFunction("src/a.ts", "fine", 20);
    run(["--update"]);
    rewriteBaseline({ ruleVersion: 0 });
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("判据版本");
    expect(output).toContain("--update");
  });

  it("判据版本一致时，放宽基线仍被拒（棘轮照旧只许下降）", () => {
    writeFunction("src/a.ts", "fine", 20);
    run(["--update"]);
    writeFunction("src/big.ts", "huge", 450);
    // 版本一致 → 拒绝
    expect(run(["--update"]).code).toBe(1);
  });

  it("判据版本变更时允许一次性重记（旧基线与新计数不是同一个量）", () => {
    writeFunction("src/a.ts", "fine", 20);
    run(["--update"]);
    rewriteBaseline({ ruleVersion: 0 });
    writeFunction("src/big.ts", "huge", 450);
    const { code, output } = run(["--update"]);
    expect(code).toBe(0);
    expect(output).toContain("一次性重记");
  });
});

/** 追加用的第二段函数体（与 writeFunction 同形，不写文件）。 */
function writeFunctionBody(name: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  const w${i} = ${i};`).join("\n");
  return `\nexport function ${name}(x: number) {\n${body}\n  return x;\n}\n`;
}
