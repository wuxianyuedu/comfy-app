// @ts-nocheck -- 提交门槛脚本：端口推导的跨语言一致性（供 .githooks/pre-commit / CI 调用）
/**
 * ISSUE #489 缺陷 4：规范 §1.1 承诺「Node / PowerShell / Python / Rust 四侧对
 * 同一路径给出同一端口」，但此前四侧各写各的固定断言，没有任何测试会发现某侧
 * 漂移（实测：Rust 不做路径解析、Node/Python/PS 对相对路径拼 cwd）。
 *
 * 本脚本以共享校验向量 tests/fixtures/app-port-vectors.json 为单一事实源：
 *   1) Node 侧真跑（本进程直接 import scripts/app-port.mjs）；
 *   2) Python 侧真跑（可用时调用 scripts/check-app-port-vectors.py）；
 *   3) Rust / PowerShell 侧无法在此环境执行（需 cargo / pwsh），改为断言其
 *      实现与测试**确实引用同一份向量文件** —— 某侧被改回「自己写死值」时
 *      会被拦下，而不是等到 Windows 真机上才发现漂移。
 * 任一侧失败以退出码 1 阻断提交。
 *
 * Node 侧的逐条断言另见 tests/app-port-cross-language.test.ts（vitest 侧同源）；
 * 本脚本是「不装依赖也能跑」的门禁版本（pre-commit 里 tsc/lint 之前更快失败）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = process.cwd();
const REL_VECTORS = "tests/fixtures/app-port-vectors.json";
const problems = [];

function readIfExists(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function hasCommand(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(path.join(ROOT, REL_VECTORS), "utf8"));
  } catch (e) {
    problems.push(`共享向量不可读（${REL_VECTORS}）：${e.message}`);
    report();
    return;
  }
  const vectors = Array.isArray(fixture.vectors) ? fixture.vectors : [];
  if (vectors.length < 5) {
    problems.push(`共享向量不足（${vectors.length} < 5）—— 防止误删后检查静默全绿`);
  }
  // 向量内自洽
  for (const v of vectors) {
    if (v.port !== 3200 + (v.fnv1a32 % 800)) {
      problems.push(`向量内不自洽：${JSON.stringify(v.input)} port ≠ 3200 + fnv % 800`);
    }
  }

  // ── ① Node 侧真跑 ──
  try {
    const mod = await import(
      "file://" + path.join(ROOT, "scripts", "app-port.mjs").replace(/\\/g, "/")
    );
    for (const v of vectors) {
      const norm = mod.normalizeRootForPort(v.input);
      if (norm !== v.normalized) {
        problems.push(`Node 规范化 ${JSON.stringify(v.input)}：${norm} ≠ ${v.normalized}`);
      }
      if (mod.fnv1a32(norm) !== v.fnv1a32) {
        problems.push(`Node FNV ${JSON.stringify(v.input)} 与向量不符`);
      }
      if (mod.derivePortFromPath(v.input) !== v.port) {
        problems.push(`Node 端口 ${JSON.stringify(v.input)} 与向量不符`);
      }
    }
  } catch (e) {
    problems.push(`Node 侧实现不可导入：${e.message}`);
  }

  // ── ② Python 侧真跑（可用时）──
  const pyChecker = "scripts/check-app-port-vectors.py";
  if (!fs.existsSync(path.join(ROOT, pyChecker))) {
    problems.push(`缺少 Python 侧自检脚本：${pyChecker}`);
  } else {
    const python = ["python3", "python"].find((c) => hasCommand(c, ["--version"]));
    if (python) {
      try {
        const out = execFileSync(python, [pyChecker], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 30_000,
        });
        if (!out.includes("OK")) problems.push(`Python 侧自检未通过：${out.trim()}`);
      } catch (e) {
        problems.push(`Python 侧自检失败：${(e.stdout || e.message || "").toString().trim()}`);
      }
    }
  }

  // ── ③ Rust / PowerShell 侧锁引用（无法在此环境执行）──
  const rust = readIfExists("src-tauri/src/single_instance.rs");
  if (!rust) problems.push("缺少 Rust 侧实现：src-tauri/src/single_instance.rs");
  else {
    if (!rust.includes("fn normalize_root_for_port"))
      problems.push("Rust 侧 normalize_root_for_port 缺失（端口推导实现被删？）");
    if (!rust.includes("app-port-vectors.json"))
      problems.push("Rust 侧测试未引用共享向量 app-port-vectors.json（四侧一致失效）");
  }

  const ps = readIfExists("scripts/app-port.ps1");
  if (!ps) problems.push("缺少 PowerShell 侧实现：scripts/app-port.ps1");
  else if (!ps.includes("Get-NormalizedRootForPort"))
    problems.push("PowerShell 侧 Get-NormalizedRootForPort 缺失（端口推导实现被删？）");
  if (!readIfExists("scripts/check-app-port-vectors.ps1"))
    problems.push("缺少 PowerShell 侧自检脚本：scripts/check-app-port-vectors.ps1");

  const pyMod = readIfExists("scripts/app_port.py");
  if (!pyMod) problems.push("缺少 Python 侧可导入模块：scripts/app_port.py");
  else if (!pyMod.includes("def normalize_root_for_port"))
    problems.push("Python 侧 normalize_root_for_port 缺失（端口推导实现被删？）");
  const launcher = readIfExists("scripts/start_tauri_launcher.py");
  if (launcher && !launcher.includes("from app_port import"))
    problems.push("start_tauri_launcher.py 未从 app_port 导入端口算法（抽模块约定被破坏）");

  report();
}

function report() {
  if (problems.length === 0) {
    console.log("[app-port-vectors] 四语言端口推导一致性 OK ✓");
    return;
  }
  console.error("[app-port-vectors] 四语言端口推导一致性失败：");
  for (const p of problems) console.error("  - " + p);
  console.error("");
  console.error("  规范：docs/standards/launch-and-build.md §1.1（推导算法是跨语言约定，");
  console.error("        四侧实现必须逐字节一致，任一侧改动须四处同步）");
  process.exit(1);
}

main().catch((e) => {
  console.error("[app-port-vectors] 检查脚本异常：" + (e && e.message));
  process.exit(1);
});
