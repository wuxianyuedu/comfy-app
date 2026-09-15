/**
 * 启动编排「下游进程提前退出」判据的回归护栏（ISSUE #553 / #489）。
 *
 * 背景：双击链路的收尾路径是「壳退出 → 连带回收 dev server 整棵进程树」，
 * 被强制收走的进程没有收尾机会，dev server 落到判定点是 exit=0 且几乎无输出。
 * 用户「关掉启动页 = 放弃本次启动」走的就是这条路（壳按约定 exit(0)），而把它
 * 与真正的启动失败写成同一句「Next.js dev server 提前退出（exit=0）」，会让：
 *   - 一次主动取消被报成红色「启动失败」；
 *   - 真正由壳侧引起的中断被引向「查 dev server 编译错」这条死路（stderr 里只有
 *     pnpm 回显的启动命令行，怎么查都查不出东西）。
 *
 * 判据现在收在 **scripts/dev-launcher.mjs**（跨平台启动编排的唯一实现）：
 *   `downstreamExitKind()` 的判决表 + `describeDownstreamExit()` 的文案；
 * 判据本身只认壳侧写下的**正标记**（launch abandoned / exiting with non-zero
 * code），不看退出码 —— 「壳也退出了」是四种成因的共同现象，由现象反推成因会把
 * 真故障说成设计内行为。
 *
 * 这一组断言此前锚在 scripts/dev-launcher.ps1 上（Windows 专属实现）；编排
 * 统一到 mjs 之后，判据与文案随之迁移，语义一条都没放宽。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LAUNCHER = join(process.cwd(), "scripts", "dev-launcher.mjs");
const launcher = readFileSync(LAUNCHER, "utf8");
const SHELL = join(process.cwd(), "src-tauri", "src", "lib.rs");
const python = readFileSync(join(process.cwd(), "scripts", "start_tauri_launcher.py"), "utf8");

/** 在临时目录里造一份壳 stderr，再用真实实现读标记（不 mock 文件系统）。 */
function markersFor(stderrText: string): { abandoned: boolean; crashed: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "comfyapp-markers-"));
  try {
    mkdirSync(join(dir, "log", "launcher"), { recursive: true });
    writeFileSync(join(dir, "log", "launcher", "dev-launcher-stderr.log"), stderrText);
    const script = `
      import { readShellMarkers } from ${JSON.stringify(LAUNCHER)};
      process.stdout.write(JSON.stringify(readShellMarkers(${JSON.stringify(dir)})));
    `;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    return JSON.parse(out.stdout || "{}") as { abandoned: boolean; crashed: boolean };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 直接调 `downstreamExitKind` 判决表（纯函数，无副作用）。 */
function decide(input: { shellExited: boolean, abandoned: boolean, shellCrashed: boolean }): string {
  const script = `
    import { downstreamExitKind } from ${JSON.stringify(LAUNCHER)};
    process.stdout.write(downstreamExitKind(${JSON.stringify(input)}));
  `;
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  return out.stdout.trim();
}

describe("编排器下游退出判据（dev-launcher.mjs）", () => {
  it("四种成因各有判定：壳未退 / 用户放弃 / 壳自身非零退出 / 壳被强行收走", () => {
    expect(decide({ shellExited: false, abandoned: false, shellCrashed: false })).toBe("dev-server");
    expect(decide({ shellExited: true, abandoned: true, shellCrashed: false })).toBe("abandoned");
    expect(decide({ shellExited: true, abandoned: false, shellCrashed: true })).toBe("shell-self-exited");
    expect(decide({ shellExited: true, abandoned: false, shellCrashed: false })).toBe("shell-terminated");
  });

  it("「用户放弃本次启动」按正常收尾：不抛失败、以 0 退出", () => {
    const describeFn = launcher.slice(launcher.indexOf("export function describeDownstreamExit"));
    const abandonedBranch = describeFn.slice(
      describeFn.indexOf('if (kind === "abandoned")'),
      describeFn.indexOf('if (kind === "shell-self-exited")'),
    );
    // 文案里必须说清「这是用户主动取消」，且不得含「失败」定性
    expect(abandonedBranch).toContain("launch abandoned");
    expect(abandonedBranch).toContain("用户放弃本次启动");
    expect(abandonedBranch).not.toContain("失败");
    // 主流程里 abandoned 走 shutdown(0)
    const conclude = launcher.slice(launcher.indexOf("async function concludeDownstreamExit"));
    const abandonedPath = conclude.slice(
      conclude.indexOf('if (kind === "abandoned")'),
      conclude.indexOf("log(detail, \"ERROR\")"),
    );
    expect(abandonedPath).toContain("shutdown(0)");
    expect(abandonedPath).not.toContain("throw");
  });

  it("壳被外部终止时把用户引向壳日志，而不是让人去查 dev server 编译错", () => {
    const description = launcher.slice(launcher.indexOf("export function describeDownstreamExit"));
    const branch = description.slice(
      description.indexOf('if (kind === "shell-terminated")'),
      description.indexOf("  return (\n    `Next.js dev server 提前退出"),
    );
    expect(branch).toContain("dev-launcher-stderr.log");
    expect(branch).toContain("壳是被强行收走的");
    // 必须给出排他结论（不是关启动页）与下一步动作
    expect(branch).toContain("从未启动");
    expect(branch).not.toMatch(/很可能|大概率|大概/);
  });

  it("壳仍在运行时提示指向 dev server 自身退出（保留原有可查路径）", () => {
    const description = launcher.slice(
      launcher.indexOf("export function describeDownstreamExit"),
      launcher.indexOf("/** 打开浏览器"),
    );
    const fallback = description.slice(description.indexOf("`Next.js dev server 提前退出"));
    expect(fallback).toContain("壳仍在运行");
    // 现场（stderr / stdout 尾部与完整文件路径）一个都不能丢 —— 它们由
    // 共用的 tail 块给出（describeDownstreamExit 顶部构造）。
    expect(description.slice(0, description.indexOf("if (kind === "))).toContain("最近 stderr");
    expect(fallback).toContain("tail");
  });

  it("shell-self-exited 点明「已被唤前台」这条设计内路径，并指回壳侧标记", () => {
    const description = launcher.slice(launcher.indexOf("export function describeDownstreamExit"));
    const branch = description.slice(
      description.indexOf('if (kind === "shell-self-exited")'),
      description.indexOf('if (kind === "shell-terminated")'),
    );
    expect(branch).toContain("exiting with non-zero code");
    expect(branch).toContain("another instance of this checkout is running");
    expect(branch).not.toMatch(/很可能|大概率|大概/);
  });

  it("「用户放弃」的结论只认壳侧正标记，不得由「壳也退出了」推断", () => {
    // 判决表的联合输入：壳退了但没有标记 → 只能是 shell-terminated（真故障），
    // 绝不能因为「壳也退出了」就判成 abandoned。
    expect(decide({ shellExited: true, abandoned: false, shellCrashed: false })).toBe("shell-terminated");
    // 反过来：标记在就必须认（哪怕退出码是 0）
    expect(decide({ shellExited: true, abandoned: true, shellCrashed: true })).toBe("abandoned");
  });

  it("标记读取真跑：大小写不敏感，且缺文件时两个都是 false", () => {
    expect(markersFor("... launch abandoned ...")).toMatchObject({ abandoned: true, crashed: false });
    expect(markersFor("Launch Abandoned")).toMatchObject({ abandoned: true });
    expect(markersFor("app exiting with non-zero code 3")).toMatchObject({ crashed: true });
    expect(markersFor("nothing here")).toMatchObject({ abandoned: false, crashed: false });
  });
});

describe("判据用到的壳标记在壳侧真实存在", () => {
  it("src-tauri 仍会写下 launch abandoned", () => {
    expect(readFileSync(SHELL, "utf8")).toContain("launch abandoned");
  });

  it('src-tauri 在异常退出码时写下 "exiting with non-zero code"（判据②）', () => {
    const lib = readFileSync(SHELL, "utf8");
    expect(lib).toContain("exiting with non-zero code");
    // 判据必须挂在 RunEvent::ExitRequested 的 code 上（hook 的退出码）
    const exitRequested = lib.slice(lib.indexOf("RunEvent::ExitRequested"));
    expect(exitRequested).toContain("Some(c) if c != 0");
  });

  it("单实例退出也留下可判据的一行（否则 stderr 里只有启动期 INFO）", () => {
    expect(readFileSync(SHELL, "utf8")).toContain("another instance of this checkout is running");
  });

  it("python 启动器同判据（两侧读同一个标记，避免语义漂移）", () => {
    expect(python).toContain('"launch abandoned" in (stderr_tail or "").lower()');
  });
});
