/**
 * 函数长度门禁自检：把 `scripts/check-function-length.cjs` 当黑盒跑在临时
 * 工作区上，验证它真能认出「超长函数」并按棘轮记账。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.13
 *
 * 为什么值得有门禁：文件行数有 R5 守着，**函数**没有 —— 于是 2186 行的单函数
 * （`settings/SettingsPageView.tsx` 的 `SettingsPageView`）一路合法存在，任何
 * 改动都要先在这两千行里定位，而「能不能拆」没有任何机器信号。
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

/** 追加用的第二段函数体（与 writeFunction 同形，不写文件）。 */
function writeFunctionBody(name: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  const w${i} = ${i};`).join("\n");
  return `\nexport function ${name}(x: number) {\n${body}\n  return x;\n}\n`;
}
