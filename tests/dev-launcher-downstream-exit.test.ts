/**
 * dev-launcher.ps1「下游进程提前退出」判据的回归护栏（ISSUE #553）。
 *
 * 背景：Prebuilt 链路的收尾路径是「壳退出 → 连带 taskkill 回收 dev server 整棵树」，
 * 被 taskkill /F 收走的进程没有收尾机会，dev server 落到判定点是 exit=0 且几乎无输出。
 * 用户「关掉启动页 = 放弃本次启动」走的就是这条路（壳按约定 exit(0)），而旧实现把它
 * 与真正的启动失败写成同一句「Next.js dev server 提前退出（exit=0）」，于是：
 *   - 一次主动取消被报成红色「启动失败」；
 *   - 真正由壳侧引起的中断被引向「查 dev server 编译错」这条死路（stderr 里只有
 *     pnpm 回显的启动命令行，怎么查都查不出东西）。
 *
 * 判据收在两处：壳 stderr 的 `launch abandoned` 标记（壳侧已有，见
 * src-tauri/src/lib.rs 的 splash CloseRequested 分支）与「壳是否已退出」。本用例在
 * 无 pwsh 的 Linux CI 上做文本与结构断言（与 tests/tools-test-entry.test.ts 同口径）。
 * 规范：docs/standards/launch-and-build.md §5、AGENTS.md 硬规则 4。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LAUNCHER = join(process.cwd(), "scripts", "dev-launcher.ps1");
const launcher = readFileSync(LAUNCHER, "utf8");

/** 取出 Get-DownstreamExitKind 的函数体，断言分类逻辑本身。 */
function downstreamKindBody(): string {
  const start = launcher.indexOf("function Get-DownstreamExitKind");
  expect(start).toBeGreaterThan(-1);
  const end = launcher.indexOf("\n}", start);
  return launcher.slice(start, end);
}

/** 取承载失败文案的那一段：就绪循环里的「进程已退出」判定块。 */
function exitLoop(): string {
  const loopStart = launcher.indexOf(
    "if ($devProc.HasExited) {",
    launcher.indexOf("等服务 Ready"),
  );
  expect(loopStart).toBeGreaterThan(-1);
  return launcher.slice(loopStart, launcher.indexOf("if (-not $ready", loopStart));
}

/** 取某个 $kind 分支的整段（到下一个 $kind 分支或退出块结束为止）。 */
function branchOf(loop: string, kind: string): string {
  const start = loop.indexOf(`$kind -eq "${kind}") {`);
  expect(start).toBeGreaterThan(-1);
  const rest = loop.slice(start + 1);
  const next = rest.indexOf('$kind -eq "');
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("dev-launcher.ps1 下游退出判据", () => {
  it("四种成因各有分支：壳未退 / 用户放弃 / 壳自身非零退出 / 壳被强行收走", () => {
    const body = downstreamKindBody();
    expect(body).toContain('if (-not $ShellExited) { return "dev-server" }');
    expect(body).toContain('if ($Abandoned) { return "abandoned" }');
    expect(body).toContain('if ($ShellCrashed) { return "shell-self-exited" }');
    expect(body).toContain('return "shell-terminated"');
  });

  it("「用户放弃本次启动」按正常收尾：不抛失败、置取消标记并跳过就绪判定", () => {
    const loopStart = launcher.indexOf("if ($devProc.HasExited) {", launcher.indexOf("等服务 Ready"));
    expect(loopStart).toBeGreaterThan(-1);
    const loop = launcher.slice(loopStart, launcher.indexOf("if (-not $ready", loopStart));
    // 命中 abandoned 分支时先写日志再置位，且不 throw
    expect(loop).toContain('$kind -eq "abandoned"');
    expect(loop).toContain("$script:LaunchAbandonedByUser = $true");
    const abandonedBranch = branchOf(loop, "abandoned");
    expect(abandonedBranch).not.toContain("throw");

    // 置位后不再因「未就绪」抛错，也不进「服务已就绪」分支
    expect(launcher).toContain("if (-not $ready -and -not $script:LaunchAbandonedByUser) {");
    expect(launcher).toContain("if ($script:LaunchAbandonedByUser) {");
  });

  it("壳被外部终止时把用户引向壳日志，而不是让人去查 dev server 编译错", () => {
    const loopStart = launcher.indexOf("if ($devProc.HasExited) {", launcher.indexOf("等服务 Ready"));
    const loop = launcher.slice(loopStart, launcher.indexOf("if (-not $ready", loopStart));
    expect(loop).toContain("log\\shell\\shell.log");
    expect(loop).toContain("壳（PID $($tauriProc.Id)）在服务就绪前已退出");
  });

  it("壳仍在运行时提示指向 dev server 自身退出（保留原有可查路径）", () => {
    const loopStart = launcher.indexOf("if ($devProc.HasExited) {", launcher.indexOf("等服务 Ready"));
    const loop = launcher.slice(loopStart, launcher.indexOf("if (-not $ready", loopStart));
    expect(loop).toContain("壳（PID $($tauriProc.Id)）仍在运行");
    // 原有现场（stderr / stdout 尾部与完整文件路径）一个都不能丢
    expect(loop).toContain("最近 stderr：");
    expect(loop).toContain("完整输出见 $nextOut 与 $nextErr");
  });

  it("标记位只初始化一次，收尾路径显式说明「已由用户取消」", () => {
    expect(launcher).toContain("$script:LaunchAbandonedByUser = $false");
    expect(launcher).toContain("本次启动已由用户取消（关闭启动页），启动器正常收尾");
  });
});

describe("判据用到的壳标记在壳侧真实存在", () => {
  it("src-tauri 仍会写下 launch abandoned", () => {
    const lib = readFileSync(join(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");
    expect(lib).toContain("launch abandoned");
  });

  it('src-tauri 在异常退出码时写下 "exiting with non-zero code"（launcher 的判据②）', () => {
    const lib = readFileSync(join(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");
    expect(lib).toContain("exiting with non-zero code");
    // 判据必须挂在 RunEvent::ExitRequested 的 code 上（hook 的退出码）
    const exitRequested = lib.slice(lib.indexOf("RunEvent::ExitRequested"));
    expect(exitRequested).toContain("Some(c) if c != 0");
  });

  it("单实例退出也留下可判据的一行（否则 stderr 里只有启动期 INFO）", () => {
    const lib = readFileSync(join(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");
    expect(lib).toContain("another instance of this checkout is running");
  });

  it("python 启动器同判据（两侧读同一个标记，避免语义漂移）", () => {
    const py = readFileSync(join(process.cwd(), "scripts", "start_tauri_launcher.py"), "utf8");
    expect(py).toContain('"launch abandoned" in (stderr_tail or "").lower()');
  });
});

describe("「用户放弃」的结论只认正标记，不得由「壳也退出了」推断", () => {


  it("壳被外部终止的分支标注只由壳侧正标记决定，退出码不参与定性", () => {
    const loop = exitLoop();
    const branch = branchOf(loop, "shell-terminated");
    // 判据是「两条正标记都为假」（等价于「壳一个字都没写」），而不是「壳也退了」
    // 这个共同现象 —— 后者会把真故障说成设计内行为。
    expect(loop).toContain("Test-ShellLaunchAbandoned");
    expect(loop).toContain("Test-ShellNonZeroExit");
    expect(branch).not.toContain("$shellAbandoned");
    expect(branch).not.toContain("$shellCrashed");
    // 提示里可以带退出码作为上下文，但不能拿它当定性依据
    expect(branch).not.toMatch(/exit=\S+ \S*属?于?\s*用户/);
  });

  it("shell-terminated 分支给出「不是关启动页」的排他结论，且指向壳日志现场", () => {
    const loop = exitLoop();
    const branch = branchOf(loop, "shell-terminated");
    expect(branch).toContain("log\\shell\\shell.log");
    expect(branch).toContain("dev-launcher-stderr.log");
    // 用户实际拿到的现场：四行 INFO + 「壳已退出」这一共同现象——它们都不足以定性
    expect(branch).not.toMatch(/很可能|大概率|大概/);
  });

  it("壳侧写了非零退出码时分到 shell-self-exited，并点明「已被唤前台」这条设计内路径", () => {
    const loop = exitLoop();
    const branch = branchOf(loop, "shell-self-exited");
    // 这一条是真失败路径：必须抛出（红色失败框），但文案要能自己解释成因
    expect(branch).toContain("throw");
    expect(branch).toContain("exiting with non-zero code");
    expect(branch).toContain("another instance of this checkout is running");
    // 「本次双击没有启动新进程」是判据允许的结论，但不得升级成「不是故障」
    expect(branch).not.toMatch(/很可能|大概率|大概/);
  });
});
