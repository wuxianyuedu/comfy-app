/**
 * 回归护栏：Build-Guard.ps1 的产物目录占用者清单要报得足够细。
 *
 * 背景：build-all / 打包启动器前置检查报「产物目录被占用」时，旧实现只列
 * `PID + 进程名 + 被映射的 dll`，用户看不出「这孤儿是谁的子孙、该连带杀哪棵子树」，
 * 只能照 PID 盲杀（AGENTS 硬规则 3 反对单杀）。本次给每个占用者补上
 * **命令行 + 父 PID + 父进程名 + 可执行文件路径**（命令行 / 父 PID 只有
 * Win32_Process(CIM) 有，Get-Process 拿不到）。
 *
 * 钉死：
 *   1. Get-ProductDirHolder 经 Get-CimInstance Win32_Process 取 CommandLine / ParentProcessId；
 *   2. 命中对象带 CommandLine / ParentId 字段；
 *   3. 补充信息抽成 Write-HolderDetail 一处，两个出口（清理失败 / 前置检查）都调用它
 *      —— 避免两处各抄一份、日后漂移。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../tools/scripts/Build-Guard.ps1"),
  "utf8",
);

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

  it("补充信息抽成 Write-HolderDetail 一处，两个出口都调用", () => {
    expect(SRC).toContain("function Write-HolderDetail");
    // 至少两处调用（清理失败出口 + 前置检查出口）。
    const calls = SRC.match(/Write-HolderDetail\s+-Indent/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("含中文的 .ps1 保持 UTF-8 with BOM（§8.4）", () => {
    const buf = fs.readFileSync(path.resolve(__dirname, "../tools/scripts/Build-Guard.ps1"));
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });
});
