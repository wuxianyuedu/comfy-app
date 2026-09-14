/**
 * Rust 函数长度门禁自检：把 `scripts/check-rust-function-length.cjs` 当黑盒跑在
 * 临时工作区上，验证它真能认出「超长函数」并按棘轮记账。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.13
 *
 * 为什么需要这条：§12.13 的 TS/TSX 门禁（`check-function-length.cjs`）**扫不到
 * Rust** —— 于是 `src-tauri/src/lib.rs` 的 `run()` 里塞了近 300 行的窗口 / 托盘 /
 * 协议 / sidecar 编排，而「能不能拆」在这条链路上没有任何机器信号（ISSUE #536 P4）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-rust-function-length.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-rust-function-length.cjs"), ...args],
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
  workdir = mkdtempSync(join(tmpdir(), "rust-function-length-gate-"));
  /* 脚本用 `__dirname/..` 定扫描根（与其它门禁脚本同一约定），所以要落在
   * 工作区的 scripts/ 下。 */
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-rust-function-length.cjs"));
  mkdirSync(join(workdir, "src-tauri", "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 造一个函数体 `bodyLines` 行的 Rust 模块。 */
function writeRustFn(rel: string, name: string, bodyLines: number): string {
  const abs = join(workdir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  const body = Array.from({ length: bodyLines }, (_, i) => `  let _v${i} = ${i};`).join("\n");
  const src = `fn ${name}() {\n${body}\n}\n`;
  writeFileSync(abs, src);
  return src;
}

/** 追加用的第二段函数体（与 writeRustFn 同形，不写文件）。 */
function rustFnBody(name: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  let _w${i} = ${i};`).join("\n");
  return `\nfn ${name}() {\n${body}\n}\n`;
}

describe("check-rust-function-length.cjs（Rust 函数长度门禁）", () => {
  it("基线文件缺失时阻断（先要求建基线）", () => {
    writeRustFn("src-tauri/src/a.rs", "short", 5);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  it("超阈值函数进拆分候选清单（--report 列名字与行号）", () => {
    writeRustFn("src-tauri/src/big.rs", "huge", 150);
    const { output } = run(["--report"]);
    expect(output).toContain("src-tauri/src/big.rs:1");
    expect(output).toContain("huge");
    expect(output).toContain("152 行");
  });

  it("小函数不进清单（阈值防噪音）", () => {
    writeRustFn("src-tauri/src/small.rs", "tiny", 20);
    const { output } = run(["--report"]);
    expect(output).toContain("（无）");
  });

  it("基线外新增超长函数阻断", () => {
    writeRustFn("src-tauri/src/ok.rs", "fine", 20);
    run(["--update"]);
    writeRustFn("src-tauri/src/new.rs", "grew", 200);
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线外新增超长函数");
    expect(output).toContain("src-tauri/src/new.rs");
  });

  it("同一文件里再长出第二个超长函数也算上升（按文件计数）", () => {
    writeRustFn("src-tauri/src/one.rs", "first", 150);
    run(["--update"]);
    const src = readFileSync(join(workdir, "src-tauri/src/one.rs"), "utf8");
    writeFileSync(
      join(workdir, "src-tauri/src/one.rs"),
      src + rustFnBody("second", 150),
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src-tauri/src/one.rs");
  });

  it("治理后（超长函数被拆掉）未收紧基线：--strict 失败，非 strict 只提示", () => {
    writeRustFn("src-tauri/src/big.rs", "huge", 150);
    run(["--update"]);
    writeRustFn("src-tauri/src/big.rs", "huge", 30); // 拆小了
    expect(run(["--strict"]).code).toBe(1);
    const relaxed = run();
    expect(relaxed.code).toBe(0);
    expect(relaxed.output).toContain("超长函数已减少");
  });

  it("字符串 / 字符字面量 / 注释里的括号不参与配对（否则函数尾会找错）", () => {
    const abs = join(workdir, "src-tauri/src", "tricky.rs");
    /* 前置一个「每行都塞进不平衡括号」的函数（括号都在字符串 / 字符 / 注释 / 块注释
     * 里）—— 若脚本按字符流硬数括号，后面的函数尾会找错，本用例就会漏报。 */
    const noise =
      'fn tricky() {\n' +
      '  let s = "} { ) (";\n' +
      '  let c = \'{\';\n' +
      '  let raw = r#"}} {{"#;\n' +
      "  // comment with ) } {\n" +
      "  /* block { { ) ) */\n" +
      "}\n\n";
    const body = Array.from({ length: 150 }, (_, i) => `  let _a${i} = ${i};`).join("\n");
    writeFileSync(abs, noise + `fn after_tricky() {\n${body}\n}\n`);
    const { output } = run(["--report"]);
    // 前面的噪声括号被忽略 → 仍应认出后面的函数
    expect(output).toContain("src-tauri/src/tricky.rs");
    expect(output).toContain("after_tricky");
    // `tricky()` 本体只有 6 行，不该进清单（注意别用 "tricky" 子串断言：
    // `after_tricky` 也含它，会误判 —— 用「行数 名字」的清单格式精确匹配）。
    expect(output).not.toMatch(/\b\d+ 行  .*  tricky\b/);
  });

  it("生命周期与泛型尖括号不破坏配对（`&'a str` / `Vec<Option<T>>`）", () => {
    const abs = join(workdir, "src-tauri/src", "generics.rs");
    const body = Array.from(
      { length: 150 },
      (_, i) => `  let _g${i}: Vec<Option<&'static str>> = Vec::new();`,
    ).join("\n");
    writeFileSync(abs, `fn with_generics<'a>(x: &'a str) {\n${body}\n  let _ = x;\n}\n`);
    const { output } = run(["--report"]);
    expect(output).toContain("with_generics");
  });

  it("同文件里有小函数混着时，只报超阈值的那个", () => {
    const abs = join(workdir, "src-tauri/src", "mixed.rs");
    const body = Array.from({ length: 150 }, (_, i) => `  let _v${i} = ${i};`).join("\n");
    writeFileSync(
      abs,
      `fn small() {\n  let _ = 1;\n}\n\nfn bigFn() {\n${body}\n}\n`,
    );
    const { output } = run(["--report"]);
    expect(output).toContain("bigFn");
    expect(output).not.toContain("small");
  });

  it("测试目录不扫（用例之间雷同、个别用例长是正常的）", () => {
    writeRustFn("src-tauri/src/tests/huge.rs", "hugeCase", 200);
    run(["--update"]);
    const { code } = run();
    expect(code).toBe(0);
  });
});
