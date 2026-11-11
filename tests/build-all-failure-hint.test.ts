/**
 * 回归护栏：一键发布构建的失败出口要按错误码分岔（ISSUE #3468）。
 *
 * 现场（2026-11-09 本机）：`pnpm tauri build` 打完 nsis、给 msi 二次 patch 同一个
 * app.exe 时撞 `os error 32`（瞬时共享冲突，实时防护 / 索引器扫刚生成的大 exe）。
 * 旧失败分支只查「有没有桌面壳」，只提 `os error 5`；壳没跑时日志里只剩一句
 * 「另一个程序正在使用此文件」，既没定性也没出口。两族占用处置完全不同：
 * 5 要先关窗口、锁不会自己消失；32 等几秒就好，且能只补打缺的那个包。
 *
 * 这里钉的是**出口的形状**（静态，形态确定能指到行），另用真宿主 Parser sweep
 * 证明改完的 .ps1 语法没坏；没装 PowerShell 宿主时那一格按三态口径跳过，
 * 不把「没跑起来」读成「判过了」。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FILE = path.resolve(ROOT, "tools/scripts/build-all.ps1");
const SRC = fs.readFileSync(FILE, "utf8");

describe("build-all.ps1 构建失败出口（ISSUE #3468）", () => {
  it("失败分支先读已落盘的日志尾部，不靠猜错误码", () => {
    expect(SRC).toMatch(/Get-Content -LiteralPath \$script:LOG -Tail 200 -Encoding UTF8/);
    expect(SRC).toContain("$tailText -match");
  });

  it("os error 32 一档给定性、等几秒重跑与单目标补打两条出口", () => {
    expect(SRC).toContain("os error 32（产物被瞬时占用）");
    expect(SRC).toContain("等几秒重跑本入口");
    expect(SRC).toContain("pnpm exec tauri bundle --bundles msi");
    // 提示要说清这一族长在哪一跳，别让人拿去套所有 os error 32。
    expect(SRC).toContain("msi 二次 patch app.exe 那一跳");
  });

  it("读不到日志时只给「没有结论」，不假装判过（§13.6.3 三态）", () => {
    expect(SRC).toContain("[没有结论] 读不到构建日志尾部");
    expect(SRC).toMatch(/if \(-not \$tailText\)/);
  });

  it("原有的 os error 5 桌面壳提示仍在，且仍挂在壳检查上", () => {
    expect(SRC).toContain("拒绝访问 (os error 5)");
    expect(SRC).toContain("Get-RunningShellProcess -ProjectRoot $PROJECT_ROOT");
  });

  it("发布顺序没被改：失败仍 exit 1，发布那一格排在构建绿之后", () => {
    expect(SRC).toMatch(/发布那一格\*\*没有执行\*\*/);
    const failAt = SRC.indexOf("if ($buildErr -ne 0)");
    const publishAt = SRC.indexOf("node scripts/publish-desktop-bundle.mjs");
    expect(failAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(failAt);
  });

  it("发布落点是项目内 dist 目录（ISSUE #3546：本地包不写常驻目录）", () => {
    expect(SRC).toContain(String.raw`$publishRoot = Join-Path $PROJECT_ROOT "dist\desktop"`);
    expect(SRC).toContain("node scripts/publish-desktop-bundle.mjs --root");
  });

  it("含中文的 .ps1 保持 UTF-8 with BOM（§8.4）", () => {
    const buf = fs.readFileSync(FILE);
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });
});

/** 与 tests/log-common-invoke.test.ts 同一套宿主探测：有别于「本机一定装了 pwsh」的假设。 */
const hosts = (() => {
  const found: Array<string> = [];
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
      found.push(candidate);
    } catch {
      // 这台机器上没有这个宿主
    }
  }
  return found;
})();

describe.skipIf(hosts.length === 0)("build-all.ps1 语法（真宿主 Parser sweep）", () => {
  it(".parse 不产生 ParseError", () => {
    const probe = [
      "$tokens = $null; $errors = $null",
      "[System.Management.Automation.Language.Parser]::ParseFile($env:JUDGE_PS1, [ref]$tokens, [ref]$errors) | Out-Null",
      "Write-Output ('PARSE_ERRORS|' + $errors.Count)",
      "$errors | ForEach-Object { Write-Output ('ERR|' + $_.Message) }",
      "",
    ].join("\n");
    for (const host of hosts) {
      const r = spawnSync(host, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", probe], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, JUDGE_PS1: FILE },
      });
      expect(r.status, `${host} 自己没跑起来：${r.stderr}`).toBe(0);
      expect(r.stdout, `${host} 解析结果：${r.stdout}${r.stderr}`).toContain("PARSE_ERRORS|0");
    }
  });
});
