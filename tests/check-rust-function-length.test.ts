/**
 * Rust 函数长度门禁自检：把 `scripts/check-rust-function-length.cjs` 当黑盒跑在
 * 临时工作区上，验证它真能认出「超长函数」并**阻断**（硬闸）。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.13
 *
 * 为什么需要这条：§12.13 的 TS/TSX 门禁（`check-function-length.cjs`）**扫不到
 * Rust** —— 于是 `src-tauri/src/lib.rs` 的 `run()` 里塞了近 300 行的窗口 / 托盘 /
 * 协议 / sidecar 编排，而「能不能拆」在这条链路上没有任何机器信号（ISSUE #536 P4）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-rust-function-length.cjs",
  dirs: ["src-tauri/src"],
});

/** 造一个函数体 `bodyLines` 行的 Rust 模块。 */
function writeRustFn(
  repo: GateRepo,
  rel: string,
  name: string,
  bodyLines: number,
): string {
  const body = Array.from(
    { length: bodyLines },
    (_, i) => `  let _v${i} = ${i};`,
  ).join("\n");
  const src = `fn ${name}() {\n${body}\n}\n`;
  repo.write(rel, src);
  return src;
}

/** 追加用的第二段函数体（与 writeRustFn 同形，不写文件）。 */
function rustFnBody(name: string, bodyLines: number): string {
  const body = Array.from(
    { length: bodyLines },
    (_, i) => `  let _w${i} = ${i};`,
  ).join("\n");
  return `\nfn ${name}() {\n${body}\n}\n`;
}

describe("check-rust-function-length.cjs（Rust 函数长度门禁）", () => {
  test("小函数放行（硬闸不需要任何基线）", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/a.rs", "short", 5);
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("超过 120 行的函数 0 个");
  });

  test("超阈值函数进拆分候选清单（--report 列名字与行号）", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/big.rs", "huge", 150);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("src-tauri/src/big.rs:1");
    expect(output).toContain("huge");
    expect(output).toContain("152 行");
  });

  test("小函数不进清单（阈值防噪音）", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/small.rs", "tiny", 20);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("（无）");
  });

  test("任何超长函数都阻断（无「已登记的存量」这一档）", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/ok.rs", "fine", 20);
    writeRustFn(repo, "src-tauri/src/new.rs", "grew", 200);
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("超长 Rust 函数");
    expect(output).toContain("src-tauri/src/new.rs");
  });

  test("同一文件里第二个超长函数也阻断", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/one.rs", "first", 150);
    const src = repo.read("src-tauri/src/one.rs");
    repo.write("src-tauri/src/one.rs", src + rustFnBody("second", 150));
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src-tauri/src/one.rs");
  });

  /* 硬闸：没有基线、也没有 --update 通道 —— 超长函数的存量已清零后，棘轮那两层
   * （基线文件 + 收紧）只剩开销。这条钉住「退出通道真的没了」。 */
  test("硬闸：--update 不写任何基线文件", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/big.rs", "huge", 150);
    repo.run(["--update"]);
    expect(
      existsSync(
        join(repo.dir, "scripts", ".rust-function-length-baseline.json"),
      ),
    ).toBe(false);
  });

  test("字符串 / 字符字面量 / 注释里的括号不参与配对（否则函数尾会找错）", ({
    repo,
  }) => {
    const rel = "src-tauri/src/tricky.rs";
    /* 前置一个「每行都塞进不平衡括号」的函数（括号都在字符串 / 字符 / 注释 / 块注释
     * 里）—— 若脚本按字符流硬数括号，后面的函数尾会找错，本用例就会漏报。 */
    const noise =
      "fn tricky() {\n" +
      '  let s = "} { ) (";\n' +
      "  let c = '{';\n" +
      '  let raw = r#"}} {{"#;\n' +
      "  // comment with ) } {\n" +
      "  /* block { { ) ) */\n" +
      "}\n\n";
    const body = Array.from(
      { length: 150 },
      (_, i) => `  let _a${i} = ${i};`,
    ).join("\n");
    repo.write(rel, `${noise}fn after_tricky() {\n${body}\n}\n`);
    const { output } = repo.run(["--report"]);
    // 前面的噪声括号被忽略 → 仍应认出后面的函数
    expect(output).toContain("src-tauri/src/tricky.rs");
    expect(output).toContain("after_tricky");
    // `tricky()` 本体只有 6 行，不该进清单（注意别用 "tricky" 子串断言：
    // `after_tricky` 也含它，会误判 —— 用「行数 名字」的清单格式精确匹配）。
    expect(output).not.toMatch(/\b\d+ 行 {2}.* {2}tricky\b/);
  });

  test("生命周期与泛型尖括号不破坏配对（`&'a str` / `Vec<Option<T>>`）", ({
    repo,
  }) => {
    const rel = "src-tauri/src/generics.rs";
    const body = Array.from(
      { length: 150 },
      (_, i) => `  let _g${i}: Vec<Option<&'static str>> = Vec::new();`,
    ).join("\n");
    repo.write(
      rel,
      `fn with_generics<'a>(x: &'a str) {\n${body}\n  let _ = x;\n}\n`,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("with_generics");
  });

  test("同文件里有小函数混着时，只报超阈值的那个", ({ repo }) => {
    const rel = "src-tauri/src/mixed.rs";
    const body = Array.from(
      { length: 150 },
      (_, i) => `  let _v${i} = ${i};`,
    ).join("\n");
    repo.write(
      rel,
      `fn small() {\n  let _ = 1;\n}\n\nfn bigFn() {\n${body}\n}\n`,
    );
    const { output } = repo.run(["--report"]);
    expect(output).toContain("bigFn");
    expect(output).not.toContain("small");
  });

  test("测试目录不扫（用例之间雷同、个别用例长是正常的）", ({ repo }) => {
    writeRustFn(repo, "src-tauri/src/tests/huge.rs", "hugeCase", 200);
    const { code } = repo.run();
    expect(code).toBe(0);
  });
});
