// 端口推导的跨语言一致性（ISSUE #489 缺陷 4）。
//
// 背景：规范 §1.1 与 changelog 都承诺「Node / PowerShell / Python / Rust 四侧
// 对同一路径给出同一端口」，但此前四侧各写各的固定断言，没有任何测试会发现某
// 一侧漂移 —— 实测就发现 Rust 的 normalize_root_for_port 完全不做路径解析，
// 而 Node / Python / PowerShell 对**相对路径**会拼 cwd，于是 `rel/p` 四侧端口
// 不同。对绝对路径（真实检出的形态）不影响，但「四侧一致」当时只是文档承诺。
//
// 本文件把「四侧一致」变成可失败断言，分两层：
//   ① 可执行层：能跑的（Node 已在本进程；Python 若可用）真跑共享向量；
//   ② 参考层：不能跑的（Rust 需 cargo、PowerShell 需 pwsh，本机/CI 均无）
//      断言其**实现与测试确实引用同一份向量文件** —— 这样某侧被改回「自己写
//      死值」时会被拦下，而不是等到 Windows 真机上才发现漂移。
//
// 共享向量：tests/fixtures/app-port-vectors.json
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const VECTORS = "tests/fixtures/app-port-vectors.json";

function readIfExists(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/** 命令是否可用（用于决定「可执行层」是否真跑）。 */
function hasCommand(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

describe("app-port 跨语言一致性（四侧读同一份共享向量）", () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(ROOT, VECTORS), "utf8"),
  ) as {
    vectors: { input: string; normalized: string; fnv1a32: number; port: number }[];
  };

  it("向量文件存在且至少 5 条（防止误删后全绿）", () => {
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(5);
  });

  it("向量内自洽：port === 3200 + fnv1a32(normalized) % 800", () => {
    for (const v of fixture.vectors) {
      expect(v.port).toBe(3200 + (v.fnv1a32 % 800));
      expect(v.port).toBeGreaterThanOrEqual(3200);
      expect(v.port).toBeLessThanOrEqual(3999);
    }
  });

  it("① Python 侧真跑共享向量（可用时）", () => {
    const script = "scripts/check-app-port-vectors.py";
    expect(fs.existsSync(path.join(ROOT, script))).toBe(true);
    const python = ["python3", "python"].find((c) => hasCommand(c, ["--version"]));
    if (!python) {
      // 无 Python 环境（罕见）：跳过可执行层，参考层仍会断言脚本引用向量。
      return;
    }
    const out = execFileSync(python, [script], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(out).toContain("OK");
    expect(out).not.toContain("FAIL");
  });

  it("② Rust 侧实现与测试引用同一份共享向量（不能真跑时锁引用）", () => {
    const rust = readIfExists("src-tauri/src/single_instance.rs");
    expect(rust).not.toBeNull();
    // 生产实现（normalize/derive）必须在，且测试必须读共享向量文件。
    expect(rust!).toContain("fn normalize_root_for_port");
    expect(rust!).toContain("fn derive_app_port_for_root");
    expect(rust!).toContain("app-port-vectors.json");
    expect(rust!).toContain("vectors");
  });

  it("② PowerShell 侧算法与自检脚本引用同一份共享向量", () => {
    const ps = readIfExists("scripts/app-port.ps1");
    expect(ps).not.toBeNull();
    expect(ps!).toContain("Get-NormalizedRootForPort");
    expect(ps!).toContain("Get-Fnv1a32");
    const checker = readIfExists("scripts/check-app-port-vectors.ps1");
    expect(checker).not.toBeNull();
    expect(checker!).toContain("app-port-vectors.json");
  });

  it("② Python 侧算法抽到可导入模块（不是内联在 Windows-only 模块里）", () => {
    const mod = readIfExists("scripts/app_port.py");
    expect(mod).not.toBeNull();
    for (const fn of [
      "def normalize_root_for_port",
      "def derive_app_port",
      "def fnv1a32",
    ]) {
      expect(mod!).toContain(fn);
    }
    // start_tauri_launcher.py 只能 Windows 导入（顶层 ctypes.windll），
    // 端口算法必须从 app_port 导入，才能在 Linux / CI 上被验证。
    const launcher = readIfExists("scripts/start_tauri_launcher.py");
    expect(launcher).not.toBeNull();
    expect(launcher!).toContain("from app_port import");
  });

  it("self-check：向量中的 Windows 盘符路径未被平台相关的 resolve 污染", () => {
    // 若某侧把 F:\\… 交给 path.resolve / abspath，在 POSIX 上会拼上 cwd，
    // 规范化结果就不再是 f:/… —— 这条检查 normalized 字段本身的形状。
    for (const v of fixture.vectors) {
      if (/^[a-zA-Z]:/.test(v.input.replace(/\\/g, "/"))) {
        expect(v.normalized).toMatch(/^[a-z]:\//);
        expect(v.normalized).not.toContain(ROOT.toLowerCase());
      }
    }
  });
});
