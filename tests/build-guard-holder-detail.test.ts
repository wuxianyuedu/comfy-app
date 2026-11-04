/**
 * 回归护栏：Build-Guard.ps1 的产物目录占用者清单要报得足够细。旧实现只列 PID + 进程名 + 映射的 dll，看不出孤儿是谁的子孙、该连带杀哪棵子树（AGENTS 硬规则 3 反对单杀）。
 * 命令行 / 父 PID 只有 Win32_Process(CIM) 有（Get-Process 拿不到）；钉死：Get-ProductDirHolder 经 CIM 取 CommandLine/ParentProcessId 且命中对象带这两字段。
 * 补充信息集中在唯一出口 Write-HolderDetail（当前仅「目录清理失败」；Assert-LauncherNotRunning 那出口已随 ISSUE #784 移除）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = fs.readFileSync(path.resolve(__dirname, "../tools/scripts/Build-Guard.ps1"), "utf8");

describe("Build-Guard.ps1 占用者清单补充命令行/父PID", () => {
  it("用 CIM(Win32_Process) 取命令行与父 PID（Get-Process 拿不到）", () => {
    expect(SRC).toContain("Get-CimInstance Win32_Process");
    expect(SRC).toContain("CommandLine");
    expect(SRC).toContain("ParentProcessId");
  });

  it("Get-ProductDirHolder 命中对象带 CommandLine / ParentId 字段", () => {
    // 结果对象构造处必须同时含这两个键。
    expect(SRC).toMatch(/CommandLine\s*=\s*[^}]+ParentId\s*=/s);
  });

  it("补充信息抽成 Write-HolderDetail 一处，报占用者的出口都调用", () => {
    expect(SRC).toContain("function Write-HolderDetail");
    const calls = SRC.match(/Write-HolderDetail\s+-Indent/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // 每个「列出占用者」的出口都必须同时给补充信息：只有一处出口时也盯住
    // 「它不是内联拼字符串」。
    expect(SRC).toContain("Get-ProductDirHolder -Directory $full");
  });

  it("含中文的 .ps1 保持 UTF-8 with BOM（§8.4）", () => {
    const buf = fs.readFileSync(path.resolve(__dirname, "../tools/scripts/Build-Guard.ps1"));
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });
});
