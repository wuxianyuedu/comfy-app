/**
 * 回归护栏：`pnpm` 工具链门禁的**可用性判据**与可行动提示（ISSUE #576）。
 *
 * 用户现场（Windows，`F:\AI\Other\Comfy-APP-T3`）：
 *
 *   dev-launcher-stderr.log 为空
 *   dev-launcher-stdout: [ERROR] pnpm 工具链不可用（exit=?）：未知错误
 *   疑似 corepack 切换版本时本地缓存损坏。
 *   修复：corepack enable && corepack prepare pnpm@<项目版本> --activate，再重启应用。
 *
 * 三个观测点指向同一个根因，但当时被读成了「缓存损坏」：
 *   ① `exit=?` + **stdout/stderr 全空** ⇒ `spawnSync` 的 `probe.error.code` 才是原因
 *      （命令压根没起来），旧实现只用 `probe.status ?? "?"` 表达，所有失败塌成一句；
 *   ② 「stderr 空」与真·corepack 缓存损坏（会在 stderr 打印
 *      `Failed to switch pnpm to ...`）恰好相反 —— 后者有输出；
 *   ③ 提示里的版本号是 `<项目版本>` 占位符。
 *
 * 本组用例钉死三条契约（反向验证：还原旧实现，对应用例必失败）：
 *   · `whichCommand` 不会选中「存在但跑不起来」的候选（含 PATHEXT 顺序与回退）；
 *   · 探测结果区分「命令起不来」与「命令报错退出」，并把 `error.code` 带出来；
 *   · 修复提示里的版本号解析自 `package.json`，且**修完必须复核**（不看 prepare 退出码）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  commandInvocation,
  executableExts,
  executableKind,
  usableCommand,
  whichCommand,
} from "../scripts/launcher-core/shell.mjs";
import {
  buildTip,
  orchestratePnpm,
  packageManagerVersion,
  probeCommand,
  probePnpm,
  shouldRepair,
} from "../scripts/launcher-core/corepack.mjs";

const ROOT = process.cwd();

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toolchain-gate-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 造一个「Windows 上的 pnpm」目录：corepack 的三个文件同名不同扩展。 */
function makeWindowsPnpmDir(options: { shim?: "broken" | "working" | "none"; ps1?: boolean; cmd?: boolean } = {}) {
  const dir = path.join(tmp, "bin");
  fs.mkdirSync(dir, { recursive: true });
  if (options.shim === "broken") {
    // shebang 指向不存在的解释器 = 「文件在、Node 起不来」的最小复刻。
    const shim = path.join(dir, "pnpm");
    fs.writeFileSync(shim, "#!/nonexistent/interpreter\n");
    fs.chmodSync(shim, 0o755);
  }
  if (options.shim === "working") {
    // Node 能起（拿当前 node 当解释器），探针不关心它打印什么。
    const shim = path.join(dir, "pnpm");
    fs.writeFileSync(shim, `#!${process.execPath}\nconsole.log("12.4.1");\n`);
    fs.chmodSync(shim, 0o755);
  }
  if (options.ps1) {
    // .ps1 回退形态：宿主不存在时它也不可用，所以这里只在需要时造出来。
    fs.writeFileSync(path.join(dir, "pnpm.ps1"), "Write-Output '12.4.1'\n");
  }
  if (options.cmd) {
    fs.writeFileSync(path.join(dir, "pnpm.CMD"), "@ECHO off\r\necho 12.4.1\r\n");
  }
  return dir;
}

const WIN_ENV = (dir: string) => ({ PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" });

/** 造一个「假的 PowerShell 宿主」：`powershellHost()` 只认二进制形态（MZ 头）。 */
function makePowerShellHost(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  // 最小二进制形态：非可打印 ASCII 起头即判 binary（`executableKind`）。
  const host = path.join(dir, "pwsh.EXE");
  fs.writeFileSync(host, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));
  fs.chmodSync(host, 0o755);
  return dir;
}

/** corepack 装的 pnpm（`.tools\pnpm\<ver>\bin`）在 Windows 上是 `.CMD` + `.ps1` 并排，
 *  且**没有**可用的无扩展名 shim。造出这个最小现场（ISSUE #576 第二轮）。 */
function makeInstalledPnpmDir(options: { cmd?: boolean; ps1?: boolean } = {}) {
  const dir = path.join(tmp, "installed-bin");
  fs.mkdirSync(dir, { recursive: true });
  if (options.cmd !== false) {
    const cmd = path.join(dir, "pnpm.CMD");
    fs.writeFileSync(cmd, "@ECHO off\r\n@SETLOCAL\r\n");
    // Windows 上 `accessSync(X_OK)` 恒通过；CI 跑在 POSIX 上要给它执行位，
    // 否则先被 `no-exec-permission` 拦下，测不到形态判据本身。
    fs.chmodSync(cmd, 0o755);
  }
  if (options.ps1 !== false) {
    const ps1 = path.join(dir, "pnpm.ps1");
    fs.writeFileSync(ps1, "#!/usr/bin/env pwsh\nWrite-Output '12.4.1'\n");
    fs.chmodSync(ps1, 0o755);
  }
  return dir;
}

describe("可执行形态的候选顺序（executableExts）", () => {
  it("Windows：真正能被 Node 起的形态在前，.CMD/.BAT 垫底", () => {
    const exts = executableExts(
      { PATH: "/nonexistent", PATHEXT: ".COM;.EXE;.BAT;.CMD;.PS1" },
      "win32",
    );
    expect(exts[0]).toBe(""); // 无扩展名（corepack shim / 已关联 node）
    expect(exts.indexOf(".PS1")).toBeGreaterThan(0);
    expect(exts.indexOf(".CMD")).toBeGreaterThan(exts.indexOf(".PS1"));
    expect(exts.indexOf(".BAT")).toBeGreaterThan(exts.indexOf(".CMD"));
  });

  it("POSIX：只有无扩展名一种形态（判据退化为原行为）", () => {
    expect(executableExts({ PATH: "/usr/bin" }, "linux")).toEqual([""]);
  });

  it("PATHEXT 里没声明的扩展名不会被硬塞进来", () => {
    const exts = executableExts({ PATH: "/x", PATHEXT: ".EXE;.CMD" }, "win32");
    expect(exts).not.toContain(".BAT");
    expect(exts).not.toContain(".PS1");
  });
});

describe("whichCommand 只认「真的能跑」的候选", () => {
  it("不可执行的 shim 不会被选中（旧实现在此选中它 → EACCES）", () => {
    const dir = makeWindowsPnpmDir({ shim: "broken", cmd: true });
    // 不可执行的 shim：明确排除。
    expect(whichCommand("pnpm", { env: WIN_ENV(dir), platform: "win32" })).toBeNull();
  });

  it("能跑的 shim 会被选中（不会被垫底的 .CMD 抢走）", () => {
    const dir = makeWindowsPnpmDir({ shim: "working", cmd: true });
    expect(whichCommand("pnpm", { env: WIN_ENV(dir), platform: "win32" })).toBe(
      path.join(dir, "pnpm"),
    );
  });

  it("形态判据读文件头而不是扩展名", () => {
    const dir = makeWindowsPnpmDir({ shim: "working", cmd: true });
    expect(executableKind(path.join(dir, "pnpm"))).toBe("shebang");
    // 批处理是**独立形态**（不是通用 script）：它只有 cmd.exe 会解释，
    // Node 起不了 —— 与 .ps1 混成一种曾被当成「可用」而选中（ISSUE #576 第二轮）。
    expect(executableKind(path.join(dir, "pnpm.CMD"))).toBe("batch");
  });

  it("不可执行的候选给出原因（权限位 / 起不来各有其名），供上层拼提示", () => {
    // 权限位不对（POSIX 上不可执行）→ no-exec-permission
    const noPerm = path.join(tmp, "pnpm");
    fs.writeFileSync(noPerm, "#!/bin/sh\necho 1\n");
    fs.chmodSync(noPerm, 0o644);
    expect(usableCommand(noPerm).reason).toBe("no-exec-permission");
    // 权限位正常但真起不来（shebang 指向不存在的解释器）→ 带出 error.code
    const dir = makeWindowsPnpmDir({ shim: "broken" });
    const result = usableCommand(path.join(dir, "pnpm"));
    expect(result.ok).toBe(false);
    expect(["ENOENT", "EACCES", "ENOEXEC"]).toContain(result.reason);
  });
});

describe("批处理形态不再被当成「可用」（ISSUE #576 第二轮，实测 EINVAL）", () => {
  /** 用户现场：命令选中 `...\.tools\pnpm\12.4.1\bin\pnpm.CMD`，探测报
   *  `EINVAL（未发现可回退形态）`，而 `pnpm.ps1` 就摆在同一个目录里。
   *  根因是 `.CMD` 与 `.ps1` 当时同被认作 `script`，而「非 shebang」直接 `ok: true`。 */
  it("`.CMD` 不被认作可用（旧实现在此 ok:true → 真跑 EINVAL）", () => {
    const dir = makeInstalledPnpmDir({ ps1: false });
    const cmd = path.join(dir, "pnpm.CMD");
    expect(executableKind(cmd)).toBe("batch");
    const usable = usableCommand(cmd, ["--version"], { env: WIN_ENV(dir), platform: "win32" });
    expect(usable.ok).toBe(false);
    // 拒绝的理由是形态（而不是拿 `exit=?` 交差），上层据此才拼得出人话。
    expect(usable.reason).toBe("batch-script");
  });

  it("同目录的 `.ps1` 就是回退：经 PowerShell 宿主起，不再报「未发现可回退形态」", () => {
    const dir = makeInstalledPnpmDir();
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const env = { PATH: `${dir}${path.delimiter}${hostDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const cmd = path.join(dir, "pnpm.CMD");
    const usable = usableCommand(cmd, ["--version"], { env, platform: "win32" });
    expect(usable.ok).toBe(true);
    expect(usable.command).toBe(path.join(hostDir, "pwsh.EXE"));
    expect(usable.prefixArgs).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(dir, "pnpm.ps1"),
    ]);
  });

  it("起服务/探测走同一个形态：commandInvocation 把 `.CMD` 映射到宿主 + `.ps1`", () => {
    const dir = makeInstalledPnpmDir();
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const env = { PATH: `${dir}${path.delimiter}${hostDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const invocation = commandInvocation(path.join(dir, "pnpm.CMD"), ["-v"], {
      env,
      platform: "win32",
    });
    expect(invocation.command).toBe(path.join(hostDir, "pwsh.EXE"));
    expect(invocation.prefixArgs).toContain(path.join(dir, "pnpm.ps1"));
  });

  it("回退同胞名是「去掉自身扩展名再拼 `.ps1`」（不是 `pnpm.CMD.ps1`）", () => {
    const dir = path.join(tmp, "only-cmd-no-ps1");
    fs.mkdirSync(dir, { recursive: true });
    const cmd = path.join(dir, "pnpm.CMD");
    fs.writeFileSync(cmd, "@ECHO off\r\n");
    fs.chmodSync(cmd, 0o755);
    // 造一个名字明显不对的同胞：`pnpm.CMD.ps1`。它**不该**被当成回退目标。
    fs.writeFileSync(path.join(dir, "pnpm.CMD.ps1"), "Write-Output '1'\n");
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const env = { PATH: `${dir}${path.delimiter}${hostDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const usable = usableCommand(path.join(dir, "pnpm.CMD"), ["--version"], { env, platform: "win32" });
    expect(usable.ok).toBe(false);
    expect(usable.reason).toBe("batch-script");
  });

  it("POSIX 上 `.cmd` 的判据不生效（内核解析 shebang / 无扩展名才是常态）", () => {
    // 同一个 `.ps1` 缺失的目录：Windows 上被否，POSIX 上「重形态」判据不参与，
    // 走的是真起一次（`.CMD` 在 Linux 上本来也是无谓形态，这里只钉平台边界）。
    const dir = makeInstalledPnpmDir({ ps1: false });
    const usable = usableCommand(path.join(dir, "pnpm.CMD"), ["--version"], {
      env: WIN_ENV(dir),
      platform: "linux",
    });
    expect(usable.reason).not.toBe("batch-script");
  });
});

describe("探测结果区分成因（probePnpm / probeCommand）", () => {
  it("命令压根没起来：reason=spawn-error 且带出 error.code（旧实现只说 exit=?）", () => {
    const dir = makeWindowsPnpmDir({ shim: "broken" });
    const probe = probeCommand(path.join(dir, "pnpm"));
    expect(probe.ok).toBe(false);
    expect(probe.exitCode).toBeNull();
    expect(probe.reason).toBe("spawn-error");
    // 关键：error.code 出现在 detail 里，不再塌成「未知错误」。
    expect(probe.detail).not.toBe("");
    expect(probe.detail).not.toBe("未知错误");
  });

  it("命令能起但报错退出：reason=exit-nonzero 且带出实际输出", () => {
    const script = path.join(tmp, "pnpm");
    fs.writeFileSync(script, "#!/bin/sh\necho 'Failed to switch pnpm to pnpm@9.9.9 ENOENT' >&2\nexit 1\n");
    fs.chmodSync(script, 0o755);
    const probe = probeCommand(script);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe("exit-nonzero");
    // 真·corepack 缓存损坏**有输出**，与「stderr 全空」的形态必须能被分开。
    expect(probe.detail).toContain("Failed to switch pnpm");
  });

  it("能用时带出解析到的版本号", () => {
    const script = path.join(tmp, "pnpm");
    fs.writeFileSync(script, "#!/bin/sh\necho 12.4.1\n");
    fs.chmodSync(script, 0o755);
    const probe = probeCommand(script);
    expect(probe.ok).toBe(true);
    expect(probe.version).toBe("12.4.1");
  });

  it("PATH 上找不到：reason=not-found", () => {
    const probe = probePnpm({ env: { PATH: tmp }, platform: "linux" });
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe("not-found");
  });
});

describe("修复提示与自愈判据", () => {
  it("版本号解析自 package.json 的 packageManager（没有 <项目版本> 占位符）", () => {
    const expected = packageManagerVersion(ROOT);
    expect(expected, "package.json 必须声明 packageManager").toBeTruthy();
    const tip = buildTip(probePnpm({ env: { PATH: tmp }, platform: "linux" }), { expected });
    expect(tip).toContain(`corepack prepare pnpm@${expected} --activate`);
    expect(tip).not.toContain("<项目版本>");
  });

  it("只有在「命令起不来」类成因下才自动重建（业务报错重装 pnpm 治不好）", () => {
    expect(shouldRepair({ ok: false, reason: "spawn-error" })).toBe(true);
    expect(shouldRepair({ ok: false, reason: "not-found" })).toBe(true);
    expect(shouldRepair({ ok: false, reason: "exit-nonzero" })).toBe(false);
    expect(shouldRepair({ ok: false, reason: "no-version" })).toBe(false);
    expect(shouldRepair({ ok: true, reason: "ok" })).toBe(false);
  });

  it("orchestratePnpm：可用时不碰任何全局状态、不给提示", () => {
    const result = orchestratePnpm({ root: ROOT });
    expect(result.probe.ok).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.tip).toBeNull();
  });

  it("orchestratePnpm：不可用（不自动重建）时给出含实际版本号的多行提示", () => {
    const result = orchestratePnpm({
      root: ROOT,
      env: { PATH: tmp },
      platform: "linux",
      autoRepair: false,
    });
    expect(result.probe.ok).toBe(false);
    expect(result.tip).toBeTruthy();
    expect(result.tip!.split("\n").length).toBeGreaterThan(1);
    expect(result.tip).toContain(packageManagerVersion(ROOT)!);
  });
});

describe("编排器与启动页的接线契约", () => {
  const launcher = fs.readFileSync(path.join(ROOT, "scripts", "dev-launcher.mjs"), "utf8");
  const splash = fs.readFileSync(
    path.join(ROOT, "src-tauri", "splash-assets", "splash.html"),
    "utf8",
  );

  it("门禁的探测与文案来自 corepack.mjs，不再自己 spawnSync 一遍", () => {
    const gate = launcher.slice(
      launcher.indexOf("export function runToolchainGate"),
      launcher.indexOf("export function reconcilePnpmVersion"),
    );
    expect(gate).toContain("orchestratePnpm(");
    expect(gate, "旧写法：自己拼 pnpm -v 探测").not.toContain('["-v"]');
  });

  it("门禁失败时把多行提示交给启动页（message 只放一行结论）", () => {
    const run = launcher.slice(
      launcher.indexOf("const gateProblem = runToolchainGate(ROOT)"),
      launcher.indexOf("log(\"工具链门禁：pnpm 可用"),
    );
    expect(run).toContain("staleShell: gateProblem");
    expect(run).toContain('gateProblem.split("\\n")[0]');
  });

  it("起 dev server 用同一个命令形态（commandInvocation），不自己拼可执行名", () => {
    expect(launcher).toContain("commandInvocation(candidate");
    const spawnDev = launcher.slice(
      launcher.indexOf("export function spawnDevServer"),
      launcher.indexOf("async function concludeDownstreamExit"),
    );
    expect(spawnDev).toContain("...invocation.prefixArgs");
  });

  it("启动页横幅按换行原样渲染（修复动作不能被压成一行）", () => {
    expect(splash).toMatch(/\.stale-banner\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it("自查入口是跨平台薄壳，且登记在 package.json 与 §9.5 对照表", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:toolchain"]).toBe("node scripts/check-pnpm-available.mjs");
    const selfCheck = fs.readFileSync(
      path.join(ROOT, "scripts", "check-pnpm-available.mjs"),
      "utf8",
    );
    // 薄壳：判据只能来自 corepack.mjs，不重写一遍探测。
    expect(selfCheck).toContain("orchestratePnpm");
    expect(selfCheck).not.toContain("spawnSync");
    const spec = fs.readFileSync(
      path.join(ROOT, "docs", "standards", "launch-and-build.md"),
      "utf8",
    );
    expect(spec).toContain("check-pnpm-available.mjs");
  });
});

/** 真跑自查脚本：可用 → 0；PATH 上没有 pnpm → 非 0 且打印修复动作。 */
describe("pnpm check:toolchain 真跑", () => {
  it("当前环境（pnpm 可用）退出 0 并报告版本", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-pnpm-available.mjs")], {
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("pnpm 可用");
  });

  it("pnpm 不可用时非零退出，并给出含版本号的修复命令", () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-pnpm-available.mjs")], {
      encoding: "utf8",
      env: { ...process.env, PATH: tmp, PATHEXT: "" },
    });
    expect(r.status).not.toBe(0);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).toContain("corepack");
    expect(out).not.toContain("<项目版本>");
  });
});
