/**
 * 桌面壳提交门禁（`scripts/shell-gate.mjs`）的判据。
 *
 * 这一步只在暂存改动命中壳输入时才做事，所以它的**触发面**比它的实现更容易出错：
 * 窄了 = 改了壳没人管（就是此前 37 条 `#[test]` 从不跑、硬规则 5 只靠人记的那个状态）；
 * 宽了 = 每个前端提交都要付一次 Rust 编译（冷实测 430s），那会让人直接 `--no-verify`，
 * 判据反而归零。本文件守的就是这两头，外加「别自己重抄一份比时间戳的逻辑」。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  RUST_SOURCE_RE,
  SHELL_INPUT_RE,
  decide,
} from "../scripts/shell-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const GATE_SCRIPT = "scripts/shell-gate.mjs";
const LAUNCHER = "scripts/dev-launcher.mjs";
const HOOK = ".githooks/pre-commit";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 从 `shellStaleWarning` 的 `const targets = [...]` 里抠出它盯的文件/目录名。 */
function launcherTargetNames(): string[] {
  const body = read(LAUNCHER);
  const fn = body.slice(body.indexOf("export function shellStaleWarning"));
  const block = /const targets = \[([\s\S]*?)\];/.exec(fn)?.[1] ?? "";
  // 条目形如 `path.join(root, "src-tauri", "tauri.conf.json")` —— 要的是**最后**那个
  // 字面量（`root` 与 `"src-tauri"` 是前缀，不是判据对象）。
  return [...block.matchAll(/path\.join\(([^)]*)\)/g)]
    .map((m) => {
      const parts = [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map(
        (q) => q[1] ?? "",
      );
      const last = parts[parts.length - 1] ?? "";
      return last.replace(/^src-tauri\//, "").replace(/\/$/, "");
    })
    .filter(Boolean)
    .sort();
}

describe("桌面壳提交门禁的触发面（§11.10.4 / 硬规则 5）", () => {
  it("没碰壳的改动：两问都是 false，这一步什么都不做", () => {
    expect(
      decide([
        "src/lib/x.ts",
        "docs/standards/11-测试与可观测性.md",
        "src-tauri/icons/a.png",
      ]),
    ).toEqual({ touchesShell: false, needsCargoTest: false });
  });

  it("只改 conf / 启动页：判时效，但不付 cargo test 那笔编译钱", () => {
    for (const file of [
      "src-tauri/tauri.conf.json",
      "src-tauri/build.rs",
      "src-tauri/splash-assets/index.html",
    ]) {
      expect(decide([file]), file).toEqual({
        touchesShell: true,
        needsCargoTest: false,
      });
    }
  });

  it("改了 Rust 源码：两问都是 true", () => {
    expect(decide(["src-tauri/src/single_instance.rs"])).toEqual({
      touchesShell: true,
      needsCargoTest: true,
    });
  });

  it("形状边界：壳输入的四种名字之外都不算（icons / capabilities / Cargo 都不在判据集合里）", () => {
    for (const notShell of [
      "src-tauri/icons/icon.png",
      "src-tauri/capabilities/default.json",
      "src-tauri/Cargo.toml",
      "src-tauri/src-not-rs/x.txt",
    ]) {
      expect(SHELL_INPUT_RE.test(notShell), notShell).toBe(false);
    }
    // Cargo.toml / Cargo.lock 不在集合里是**有意的**：时效判据不比它们（见下一条），
    // 要扩就得两边同改，不能只在这侧加。
    expect(RUST_SOURCE_RE.test("src-tauri/Cargo.lock")).toBe(false);
  });

  it("判据集合与 shellStaleWarning 的 targets 同源，不许各数一半", () => {
    // 这一步比时间戳，而时间戳由 launcher 那侧定义；两份清单一旦漂移，就会出现
    // 「launcher 说壳旧了，提交门禁却放行」这类两头都对不上的状态。
    expect(launcherTargetNames()).toEqual(
      ["build.rs", "splash-assets", "src", "tauri.conf.json"].sort(),
    );
    const covered = [
      "src-tauri/tauri.conf.json",
      "src-tauri/build.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/splash-assets/splash.html",
    ];
    for (const f of covered) expect(SHELL_INPUT_RE.test(f), f).toBe(true);
  });

  it("复用 launcher 的时效判据，不自己重抄一份比时间戳的逻辑（§12.18）", () => {
    const src = read(GATE_SCRIPT);
    expect(src).toContain("shellStaleWarning");
    expect(src).toContain("defaultShellExe");
    // 自己 statSync 壳或源码 mtime = 第二份实现，会漂。
    expect(src).not.toMatch(/mtimeMs/);
    expect(src).not.toMatch(/statSync\(/);
  });

  it("新增的门禁脚本必须同时接进 pre-commit（§11.7 那条规则）", () => {
    const hook = read(HOOK);
    expect(hook).toContain("node scripts/shell-gate.mjs");
  });

  it("cargo 缺失时不静默放行：脚本必须给出可行动的指路", () => {
    const src = read(GATE_SCRIPT);
    expect(src).toContain("whichCommand");
    expect(src).toMatch(/rustup\.rs/);
    // 找不到 cargo 的分支必须返回非零，而不是 `return 0` 蒙过去。
    expect(src).toMatch(/return 1;\s*\n\s*\}\s*\n\s*if \(code !== 0\)/);
  });

  it("脚本与钩子都在（防「判据写在文档里、文件却没了」）", () => {
    for (const rel of [GATE_SCRIPT, HOOK, LAUNCHER]) {
      expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });
});
