/**
 * 回归护栏：`pnpm` 工具链门禁的可用性判据与可行动提示（ISSUE #576）。现场 `exit=?` + 输出全空 ⇒ 真因是 `probe.error.code`（命令没起来），
 * 旧实现用 `probe.status ?? "?"` 塌成一句；「stderr 空」恰与 corepack 缓存损坏（会打印 `Failed to switch pnpm to …`）相反，提示版本只是占位符。
 * 钉三条契约：不选「存在但跑不起来」的候选（含 PATHEXT 顺序与回退）、区分起不来与非零退出并带出 `error.code`、修复版本取自 `package.json` 且修完必须复核。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launcherChainSource } from "./helpers/launcher-source";
import { stripComments } from "./helpers/strip-comments";

/**
 * 依赖 POSIX 执行语义的用例开关（shebang 被内核解析、chmod exec 位有效）。Windows 上 libuv 不解析 shebang、
 * chmodSync 不存执行位，这些 spawn 探测必然失败 —— 它们给 POSIX CI（原 .cnb.yml）钉契约；Windows 侧对应
 * 行为已由「.CMD 否决 / .ps1 回退」那组不依赖真实 spawn 的用例钉住。
 */
const needsPosixExec = it.skipIf(process.platform === "win32");

import {
  commandInvocation,
  executableExts,
  executableKind,
  pnpmInvocation,
  usableCommand,
  whichCommand,
} from "../scripts/launcher-core/shell.mjs";
import { pnpmCli } from "../scripts/ci-install-deps.mjs";
import {
  buildTip,
  clearPnpmProbeCache,
  orchestratePnpm,
  packageManagerVersion,
  preparePnpm,
  probeCommand,
  probePnpm,
  shouldRepair,
} from "../scripts/launcher-core/corepack.mjs";

const ROOT = process.cwd();

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toolchain-gate-"));
  // `probePnpm` 有进程内记忆化，而本文件的用例会在**同一个 tmp 路径**上覆写重造
  // pnpm 形态 —— 每个用例先清它，避免读到上一个用例的旧结论。
  // （`whichCommand` 不再记忆化，每次都重新解析，ISSUE #3327。）
  clearPnpmProbeCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 造一个「Windows 上的 pnpm」目录：corepack 的三个文件同名不同扩展。 */
function makeWindowsPnpmDir(
  options: {
    cmd?: boolean;
    ps1?: boolean;
    shim?: "broken" | "working" | "none";
  } = {},
) {
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
  if (options.ps1 === true) {
    // .ps1 回退形态：宿主不存在时它也不可用，所以这里只在需要时造出来。
    fs.writeFileSync(path.join(dir, "pnpm.ps1"), "Write-Output '12.4.1'\n");
  }
  if (options.cmd === true) {
    fs.writeFileSync(path.join(dir, "pnpm.CMD"), "@ECHO off\r\necho 12.4.1\r\n");
  }
  return dir;
}

const WIN_ENV = (dir: string) => ({
  PATH: dir,
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
});

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

  it("PATHEXT 里没声明的扩展名不会被硬塞进来（`.PS1` 除外，见下条）", () => {
    const exts = executableExts({ PATH: "/x", PATHEXT: ".EXE;.CMD" }, "win32");
    expect(exts).not.toContain(".BAT");
  });

  /**
   * `.PS1` **不看 `PATHEXT`**（ISSUE #1961）。此前判据是反向的：老用例断言没声明就不出现，而 Windows 默认
   * `PATHEXT`（`.COM;.EXE;.BAT;.CMD;…`）从不含 `.PS1`。corepack 摆的三个形态里只有 `.ps1` 能被 Node 起，候选表却没有它
   * ⇒ `whichCommand()` 一个都选不出 ⇒ 上层报「PATH 上没有可用 pnpm 形态」，而能跑的就在旁边（现场流水线停在不成立的结论上）。
   */
  it("`.PS1` 无条件在候选里 —— 默认 PATHEXT 从不声明它，由它决定就是永远选不出来", () => {
    // Windows 的默认 PATHEXT（实测形态：没有 .PS1）。
    const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";
    const exts = executableExts({ PATH: "/x", PATHEXT: DEFAULT_PATHEXT }, "win32");
    expect(exts).toContain(".PS1");
    // 顺序仍按「Node 能不能直接起」：`.PS1` 在 `.CMD` / `.BAT` **之前**
    // （`.CMD` 只有 cmd.exe 解释，Node 起它实测 EINVAL）。
    expect(exts.indexOf(".PS1")).toBeLessThan(exts.indexOf(".CMD"));
    expect(exts.indexOf(".PS1")).toBeLessThan(exts.indexOf(".BAT"));
    // PATHEXT 里声明的其它项照旧保留（保持「用户配了就用」）。
    expect(exts).toContain(".VBS");
  });

  it("没给 PATHEXT 时也含 `.PS1`（不能靠「有没有那份环境变量」决定形态）", () => {
    expect(executableExts({ PATH: "/x" }, "win32")).toContain(".PS1");
  });

  it("POSIX 上不出现 `.PS1`（判据不按平台之外的东西分叉）", () => {
    expect(executableExts({ PATH: "/usr/bin" }, "linux")).toEqual([""]);
  });
});

/**
 * `.PS1` 是候选里的一员 —— 这一格此前**没有任何判据**（ISSUE #1961）：`executableExts` 在 `PATHEXT` 不含 `.PS1` 时根本不摆出
 * `pnpm.ps1`，于是「`.ps1` 回退」只在「先撞上 `.CMD`」的路径上被走到；直接摆一个 `pnpm.ps1` 的目录（corepack 装出来的形态）
 * 修复前一个候选都命中不了。代价：`pnpmInvocation()` 返回 `null`，自证报「pnpm 不可用」，流水线第 1 秒就停。
 */
describe("`.PS1` 是候选（Windows 默认 PATHEXT 不含它，ISSUE #1961）", () => {
  /**
   * 只摆一个 `pnpm.PS1`（无扩展名 shim 与 `.CMD` 都不在）的目录。**大写**是刻意的：候选按 `PATHEXT` 的写法拼
   * （`.PS1`），判据走到「这个文件在不在盘上」。NTFS 不敏感、大小写随便写都命中；CI 跑在 POSIX，那里
   * `pnpm.ps1` 与 `pnpm.PS1` 是两个文件 —— 写小写会让这条用例在 Linux 上恒假（判的是宿主的大小写敏感）。
   */
  const ps1OnlyDir = () => {
    const dir = path.join(tmp, "ps1-only");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const ps1 = path.join(dir, "pnpm.PS1");
    fs.writeFileSync(ps1, "#!/usr/bin/env pwsh\nWrite-Output '12.4.1'\n");
    fs.chmodSync(ps1, 0o755);
    return dir;
  };

  it("默认 PATHEXT 下，摆在 PATH 上的 `pnpm.ps1` 被选中（经宿主起）", () => {
    const dir = ps1OnlyDir();
    const hostDir = makePowerShellHost(path.join(tmp, "host-ps1"));
    /* 真实 Windows 默认 `PATHEXT` —— 关键就是它**没有** `.PS1`。 */
    const env = {
      PATH: `${dir}${path.delimiter}${hostDir}`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
    };
    /* 反向验证：把 `executableExts` 里那句 `.PS1` 无条件放行去掉，这一格立刻
     * 从 `pnpm.ps1` 变回 `null` —— 这正是修复前的实测读数。 */
    const found = whichCommand("pnpm", {
      env,
      platform: "win32",
      probeArgs: ["-v"],
    });
    expect(found, "`.ps1` 在盘上却一个候选都没命中").not.toBeNull();
    expect(found!.toLowerCase()).toBe(path.join(dir, "pnpm.PS1").toLowerCase());

    /* 「找到」不够，上层要的是**能 spawn 的形态**：`.ps1` 与 `.cmd` 一样，
     * Node 自己起不来，必须交 PowerShell 宿主 + `-File`。 */
    const usable = usableCommand(found!, ["-v"], { env, platform: "win32" });
    expect(usable.ok).toBe(true);
    expect(usable.command.toLowerCase()).toBe(path.join(hostDir, "pwsh.EXE").toLowerCase());
    expect(usable.prefixArgs).toContain("-File");
    expect(usable.prefixArgs).toContain(found);
  });

  /**
   * 反向：`.ps1` 被摆上 PATH 时，**没有宿主就不能算「可用」**。这一格判的是「`.PS1` 进候选表」之后必须同批补上的
   * 另一半：只让它被找到、却给出 `prefixArgs: []` 的形态，等于把缺陷从「找不到」挪成「找到了但起不来」——
   * 后者更贵（上层拿着它去 spawn，然后拿到一个说不清成因的失败）。
   */
  it("`.ps1` 的形态是「宿主 + `-File`」，不是把 `.ps1` 自己当可执行文件", () => {
    const dir = ps1OnlyDir();
    const ps1 = path.join(dir, "pnpm.PS1");
    /* 只给 `.ps1` 所在的目录、不给宿主 —— `powershellHost()` 找不到可用的宿主。 */
    const noHost = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const usable = usableCommand(ps1, ["-v"], {
      env: noHost,
      platform: "win32",
    });
    expect(usable.ok, "没有宿主时 `.ps1` 不许被认作可用").toBe(false);
    expect(usable.reason).toBe("no-powershell-host");
  });

  it("POSIX 上同一条判据不生效（`.PS1` 不是那儿的形态）", () => {
    const dir = ps1OnlyDir();
    expect(
      whichCommand("pnpm", {
        env: { PATH: dir },
        platform: "linux",
        probeArgs: ["-v"],
      }),
    ).toBeNull();
  });
});

describe("whichCommand 只认「真的能跑」的候选", () => {
  it("不可执行的 shim 不会被选中（旧实现在此选中它 → EACCES）", () => {
    const dir = makeWindowsPnpmDir({ shim: "broken", cmd: true });
    // 不可执行的 shim：明确排除。
    expect(whichCommand("pnpm", { env: WIN_ENV(dir), platform: "win32" })).toBeNull();
  });

  needsPosixExec("能跑的 shim 会被选中（不会被垫底的 .CMD 抢走）", () => {
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

  it("不可执行的候选给出原因（起不来 → 带出 error.code），供上层拼提示", () => {
    // 权限位正常但真起不来（shebang 指向不存在的解释器）→ 带出 error.code。
    // 平台无关：ENOENT（Windows 起不了无扩展名脚本）与 ENOEXEC / EACCES（POSIX）
    // 都算「真起了一下的失败」，reason 必须带出具体 code 而不是塌成一句。
    const dir = makeWindowsPnpmDir({ shim: "broken" });
    const result = usableCommand(path.join(dir, "pnpm"));
    expect(result.ok).toBe(false);
    expect(["ENOENT", "EACCES", "ENOEXEC"]).toContain(result.reason);
  });

  needsPosixExec(
    "不可执行的候选给出原因：权限位不对 → no-exec-permission（exec 位是 POSIX 语义）",
    () => {
      const noPerm = path.join(tmp, "pnpm");
      fs.writeFileSync(noPerm, "#!/bin/sh\necho 1\n");
      fs.chmodSync(noPerm, 0o644);
      expect(usableCommand(noPerm).reason).toBe("no-exec-permission");
    },
  );
});

describe("批处理形态不再被当成「可用」（ISSUE #576 第二轮，实测 EINVAL）", () => {
  /** 用户现场：命令选中 `...\.tools\pnpm\12.4.1\bin\pnpm.CMD`，探测报
   *  `EINVAL（未发现可回退形态）`，而 `pnpm.ps1` 就摆在同一个目录里。
   *  根因是 `.CMD` 与 `.ps1` 当时同被认作 `script`，而「非 shebang」直接 `ok: true`。 */
  it("`.CMD` 不被认作可用（旧实现在此 ok:true → 真跑 EINVAL）", () => {
    const dir = makeInstalledPnpmDir({ ps1: false });
    const cmd = path.join(dir, "pnpm.CMD");
    expect(executableKind(cmd)).toBe("batch");
    const usable = usableCommand(cmd, ["--version"], {
      env: WIN_ENV(dir),
      platform: "win32",
    });
    expect(usable.ok).toBe(false);
    // 拒绝的理由是形态（而不是拿 `exit=?` 交差），上层据此才拼得出人话。
    expect(usable.reason).toBe("batch-script");
  });

  it("同目录的 `.ps1` 就是回退：经 PowerShell 宿主起，不再报「未发现可回退形态」", () => {
    const dir = makeInstalledPnpmDir();
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const env = {
      PATH: `${dir}${path.delimiter}${hostDir}`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const cmd = path.join(dir, "pnpm.CMD");
    const usable = usableCommand(cmd, ["--version"], {
      env,
      platform: "win32",
    });
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
    const env = {
      PATH: `${dir}${path.delimiter}${hostDir}`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
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
    const env = {
      PATH: `${dir}${path.delimiter}${hostDir}`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const usable = usableCommand(path.join(dir, "pnpm.CMD"), ["--version"], {
      env,
      platform: "win32",
    });
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

  needsPosixExec("命令能起但报错退出：reason=exit-nonzero 且带出实际输出", () => {
    const script = path.join(tmp, "pnpm");
    fs.writeFileSync(
      script,
      "#!/bin/sh\necho 'Failed to switch pnpm to pnpm@9.9.9 ENOENT' >&2\nexit 1\n",
    );
    fs.chmodSync(script, 0o755);
    const probe = probeCommand(script);
    expect(probe.ok).toBe(false);
    expect(probe.reason).toBe("exit-nonzero");
    // 真·corepack 缓存损坏**有输出**，与「stderr 全空」的形态必须能被分开。
    expect(probe.detail).toContain("Failed to switch pnpm");
  });

  needsPosixExec("能用时带出解析到的版本号", () => {
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
    const tip = buildTip(probePnpm({ env: { PATH: tmp }, platform: "linux" }), {
      expected,
    });
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

  /* 这一条判的是「可用时不碰全局状态」—— 前提是**这一跑拿得到 pnpm**。
   * 平台节点是服务账号会话，PATH 里没有它（ISSUE #2281），那台机上这条前提不成立；
   * 拿不到就跳过并把原因留在名上，不许把它读成「判据过了」。 */
  (envWithPnpm() ? it : it.skip)("orchestratePnpm：可用时不碰任何全局状态、不给提示", () => {
    const result = orchestratePnpm({ root: ROOT, env: envWithPnpm() ?? process.env });
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
  /* 编排器已按职责拆进 `launcher-core/`（ISSUE #1811 拆 R5 超限文件），下面几条
   * 断言钉的是**编排链路里的形态**（用没用自己的探测写法、接没接线），与「它住
   * 在哪个文件」无关 —— 所以这里把主文件与拆出的几份拼成一份「链路源码」再断言。
   * 逐份读而不是只读主文件：只读主文件时，搬走的实现会让 `indexOf` 落空、
   * `slice(0, -1)` 拿到空串，断言会**静默变成空转**（`not.toContain` 恒真）。 */
  /* 走现算的链路闭包（不手抄清单）：抄了就会随下一刀拆文件再漏一处，而漏的
   * 表现正是这条判据要防的 —— `indexOf` 落空、`not.toContain` 对着空串恒真。 */
  const launcher = launcherChainSource();
  const splash = fs.readFileSync(
    path.join(ROOT, "src-tauri", "splash-assets", "splash.html"),
    "utf8",
  );

  it("门禁的探测与文案来自 corepack.mjs，不再自己 spawnSync 一遍", () => {
    /* 实现对在 `launcher-core/preflight.mjs`：主文件只剩同名薄包装（它的函数体
     * 只有一行转发，拿它断言等于什么都没测）。 */
    const preflight = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "preflight.mjs"),
      "utf8",
    );
    const gate = preflight.slice(
      preflight.indexOf("export function runToolchainGate"),
      preflight.indexOf("export function reconcilePnpmVersion"),
    );
    expect(gate, "没取到实现体，断言会空转").toContain("orchestratePnpm(");
    expect(gate, "旧写法：自己拼 pnpm -v 探测").not.toContain('["-v"]');
  });

  it("门禁失败时把多行提示交给启动页（message 只放一行结论）", () => {
    /* 判决随预检桥段搬进 `launcher-core/startup-gates.mjs`（ISSUE #1811 拆 R5）：
     * 它产出 `{ message, statusMessage, staleShell }`，编排器那层写启动页。契约是
     * 「多行提示进 stale_shell 横幅、message 只放一行结论」，不是「这段写在哪」。
     * 判据落在**产出**上：`statusMessage` 是首行、`staleShell` 是全文。 */
    const gates = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "startup-gates.mjs"),
      "utf8",
    );
    expect(gates).toContain(String.raw`gateProblem.split("\n")[0]`);
    expect(gates).toContain("staleShell: gateProblem");
    // 编排器那一层负责把产出交给启动页（横幅字段不许在转发时丢掉）。
    expect(launcher).toContain("gated.error.staleShell");
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
    /* SAFETY: 类型断言已复核 */
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

/**
 * 在「这一跑确定拿得到 pnpm」的环境里起自查脚本（ISSUE #2281）。它判的是**自查脚本自己的结论**，而此前用例直接继承
 * 宿主环境——平台侧那台机是服务账号会话、PATH 里没有 pnpm，前提在 CI 上不成立，八条用例一起红在宿主。这里用同一条发现
 * 逻辑（`pnpmCli()`，与产品代码共用）把落点补进 PATH；真找不到时返回 `null`，用例据此跳过并说出原因 —— 那仍是「没量到」。
 */
function envWithPnpm() {
  const cli = pnpmCli({ write: () => undefined });
  if (!cli.resolved) {
    return null;
  }
  const dir = path.dirname(cli.command);
  return {
    ...process.env,
    PATH: [dir, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

/** 真跑自查脚本：可用 → 0；PATH 上没有 pnpm → 非 0 且打印修复动作。 */
describe("pnpm check:toolchain 真跑", () => {
  const env = envWithPnpm();
  const runIfPnpm = env ? it : it.skip;
  runIfPnpm("当前环境（pnpm 可用）退出 0 并报告版本", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      {
        encoding: "utf8",
        env: env ?? process.env,
      },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    expect(r.stdout).toContain("pnpm 可用");
  });

  runIfPnpm("依赖已装时，结论里点名 tsc / eslint / vitest 都能跑（不是只报「已装」）", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      { encoding: "utf8", env: env ?? process.env },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    // 这句是判据本身：它把「依赖在」与「三条门禁可跑」连在一起，
    // 否则读者只会看到「node_modules 已装」这句与门禁无关的话（ISSUE #1568）。
    expect(r.stdout).toContain("tsc / eslint / vitest 都能跑");
  });

  /**
   * 「无 node_modules」这一分支的措辞就是判据（ISSUE #1568）。现场：有人在无依赖容器里读旧版一句 WARN + `pnpm install`，
   * 得出「本机跑不了 tsc/eslint/vitest」，跳过三条门禁并写进提交信息 —— 25 条类型错因此落进 `master`。故它必须正面回答
   * 「能装 / 装多久 / 装完能跑什么」并点名「不得据此跳过门禁」；`--deps-root` 只换依赖检查根，给空目录即可复现。
   */
  runIfPnpm("依赖未装时：说清「能装 / 装多久 / 装完能跑什么」，并点名禁止据此跳过门禁", () => {
    const emptyRoot = path.join(tmp, "no-deps");
    fs.mkdirSync(emptyRoot, { recursive: true });
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs"), "--deps-root", emptyRoot],
      { encoding: "utf8", env: env ?? process.env },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    // 依赖未装只是「还没装」：自检仍以 0 退出（它判的是工具链可用性），
    // 但必须把可行动作与「可装」这个结论摆出来。
    expect(r.status, out).toBe(0);
    expect(out).toContain("可装");
    expect(out).toContain("公开 registry");
    expect(out).toContain("pnpm install --frozen-lockfile");
    // 「装完能跑什么」：具体点名三条门禁，别只写「修复：pnpm install」。
    expect(out).toContain("tsc --noEmit / eslint / vitest");
    // 点名那条反模式本身，让下一个读到这句话的人知道它不被接受。
    expect(out).toContain("本容器无 node_modules");
    expect(out).toContain("§13.6.3");
  });

  it("依赖判据与启动器同一个实现（不在自检里留一份弱化副本）", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "check-pnpm-available.mjs"), "utf8");
    // 两份口径并存时「自检说已装、启动器说残缺」是必然的，且会各自漂移：
    // 旧版这里只查 `.modules.yaml` 一项，而启动器查 .bin/next + 关键依赖目录。
    expect(src).toContain("checkNodeModules");
    expect(src).toContain("launcher-core/worktree.mjs");
    // 不许在本文件里**再定义**一份 `checkNodeModules` 函数（注释里提到判据键没问题）。
    expect(src).not.toMatch(/function\s+checkNodeModules/);
  });

  it("pnpm 不可用时非零退出，并给出含版本号的修复命令", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: tmp, PATHEXT: "" },
      },
    );
    expect(r.status).not.toBe(0);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).toContain("corepack");
    expect(out).not.toContain("<项目版本>");
  });

  it("pnpm 不可用时把**这一份进程读到的 PATH** 打出来（ISSUE #2281）", () => {
    /* 反面现场：一份平台日志写着「（一个都没命中）」，而同一台机上 `where pnpm` /
     * `pnpm -v` / 本脚本重跑三次全部正常 —— 两句话都对，它们说的不是同一件事，
     * 而日志里没有任何一行能把它们分开。所以探不到的那一刻必须留下原文。 */
    const badPath = path.join(tmp, "only-here");
    fs.mkdirSync(badPath, { recursive: true });
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: badPath, PATHEXT: "" },
      },
    );
    expect(r.status).not.toBe(0);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out, "探不到 pnpm 时没有留下读取到的 PATH 原文").toContain("PATH 原文");
    expect(out).toContain(badPath);
    // 空目录里一个都没命中，要说清是「这些条目里没有」，不写成「这台机没装」。
    expect(out).toContain("一个都没命中");
  });
});

/** 版本不一致时，自查入口必须与启动器同一条口径：**先对齐、复核通过才算一致**（ISSUE #576 第三轮）。
 *
 *  用户现场：`pnpm check:toolchain` 只报一句 `[WARN] 版本与 package.json 要求不一致（本机 10.34.5，要求 12.4.1）`
 *  就结束，而真启动时启动器自己会 corepack 对齐（`reconcilePnpmVersion()` → `preparePnpm()` + 复核），
 *  `prepare-local-run.ps1` 第 3 步早已如此；脚本还以 0 退出，不提示后面还有「node_modules 未装」门禁。 */
describe("pnpm check:toolchain：版本不一致时复用启动器的对齐口径", () => {
  /** 造一个能跑的 POSIX pnpm + corepack：corepack prepare 会把「激活状态」落盘，
   *  pnpm 据此报告不同版本（对齐成功 / 失败的两种现场都靠它模拟）。 */
  function makeAlignableToolchain(options: { aligns: boolean }) {
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin, { recursive: true });
    const marker = path.join(tmp, "activated");
    const pnpmScript = path.join(bin, "pnpm");
    fs.writeFileSync(
      pnpmScript,
      [
        "#!/bin/sh",
        `if [ "$1" = "-v" ]; then`,
        `  if [ -f "${marker}" ]; then printf 12.4.1; else printf 10.34.5; fi`,
        "  exit 0",
        "fi",
        "",
      ].join("\n"),
    );
    fs.chmodSync(pnpmScript, 0o755);
    const corepackScript = path.join(bin, "corepack");
    fs.writeFileSync(
      corepackScript,
      [
        "#!/bin/sh",
        `if [ "$1" = "--version" ]; then echo 0.34.0; exit 0; fi`,
        options.aligns ? `: > "${marker}"` : `echo "prepare failed" >&2; exit 1`,
        "exit 0",
        "",
      ].join("\n"),
    );
    fs.chmodSync(corepackScript, 0o755);
    return bin;
  }

  function runSelfCheck(bin: string) {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      { encoding: "utf8", env: { ...process.env, PATH: bin, PATHEXT: "" } },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  needsPosixExec("对齐成功：报已对齐（带前后版本号），不留下「你只能自己修」的 WARN", () => {
    const { status, out } = runSelfCheck(makeAlignableToolchain({ aligns: true }));
    expect(status).toBe(0);
    expect(out).toContain("已对齐");
    expect(out).toContain("10.34.5");
    expect(out).toContain(packageManagerVersion(ROOT)!);
    expect(out).not.toContain("自动对齐未生效");
  });

  needsPosixExec("对齐失败：复核后才 WARN，并给出手动命令（版本号取自 package.json）", () => {
    const { status, out } = runSelfCheck(makeAlignableToolchain({ aligns: false }));
    expect(status).toBe(0); // 与启动器一致：版本不一致不阻断
    expect(out).toContain("自动对齐未生效");
    expect(out).toContain(`corepack prepare pnpm@${packageManagerVersion(ROOT)} --activate`);
  });

  needsPosixExec(
    "node_modules 未装时点出下一道门禁，不让「[OK] pnpm 可用」被读成「可以启动了」",
    () => {
      const { status, out } = runSelfCheck(makeAlignableToolchain({ aligns: true }));
      expect(status).toBe(0);
      // 本仓库测试环境两态都可能（CI 装了 / 干净检出没装），只钉「不存在假装没事」：
      // 未装时必须出现 node_modules 的 WARN 与修复动作。
      const marker = path.join(ROOT, "node_modules", ".modules.yaml");
      if (!fs.existsSync(marker)) {
        expect(out).toContain("node_modules");
        expect(out).toContain("pnpm install");
      }
    },
  );
});

/** 自检要把「探到的是哪个 pnpm」打印清楚（ISSUE #576 第四轮）：现场 `pnpm --version` → 12.4.1，而
 *  `pnpm check:toolchain` → `[OK] pnpm 可用：10.34.5（C:\…\pwsh.EXE）`。终端敲的 `pnpm` 与 Node 探到的**不是同一个
 *  文件**（corepack 的 `.ps1` 须经宿主执行，故命令名是 `pwsh.EXE`）；PATH 并存多个时选中者又是另一个版本。
 *  旧文案只给「版本号 + 命令名」，现场看起来就无解。契约：① 打印选中的文件；② 经宿主执行额外打印「宿主 →
 *  真实文件」；③ 版本漂移提示把方向指向「选中的 pnpm」。 */
describe("pnpm check:toolchain：打印探测身份，版本漂移可自解释", () => {
  it("经宿主执行时，选中的文件与真实命名的区别可被解释（`.ps1` → 宿主）", () => {
    const dir = makeInstalledPnpmDir({ cmd: false });
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const script = path.join(dir, "pnpm.ps1");
    // 仓库里跑的是 POSIX（没有真 pwsh）：宿主形态由注入的 env/platform 模拟，
    // 这与被测路径在 Windows 上实际走的是同一条 `siblingFallback()`。
    const invocation = commandInvocation(script, ["-v"], {
      env: WIN_ENV(dir),
      platform: "win32",
    });
    const host = path.join(hostDir, "pwsh.EXE");
    // 经宿主时命令名会变成宿主（现场里那句 `（…\pwsh.EXE）` 就是这么来的）——
    // 自检据此把「命令是 pwsh.EXE」译回「它跑的是哪个 .ps1」。
    if (invocation.command === host) {
      expect(invocation.prefixArgs).toContain(script);
    } else {
      // 机器上 `.ps1` 被当成可直接执行（POSIX 的 shebang 语义）时退化为原样调用：
      // 那也满足「命令名可解释」，只是无需再打印宿主一行。
      expect(invocation.command).toBe(script);
    }
  });

  (envWithPnpm() ? it : it.skip)("自检打印「选中的 pnpm」一行（版本漂移的先查对象）", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      {
        encoding: "utf8",
        env: envWithPnpm() ?? process.env,
      },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(`${r.stdout ?? ""}${r.stderr ?? ""}`).toContain("选中的 pnpm：");
  });
});

/**
 * 回归护栏：**任何**由 Node 去 spawn pnpm 的地方都走同一条形态判据（ISSUE #576）。现场双击 `start-tauri.exe` 报「dev-launcher.mjs
 * 提前退出（exit=1）」，两秒后 `dev server 自身退出（exit=0）`、stderr 全空。根因在 `scripts/dev.mjs` 写死 `spawnSync("pnpm.cmd", …)`：
 * Windows 上批处理只有 cmd.exe 会解释，`result.status === null` 被旧代码 `?? 0` 读成成功退出。契约：唯一出口 `pnpmInvocation`、命令没起来必须分开报。
 */
describe("内层 spawn pnpm 复用同一形态判据（ISSUE #576 第五轮）", () => {
  it("pnpmInvocation 与 whichCommand + commandInvocation 结果一致", () => {
    // 用户现场形态：`.tools\pnpm\<ver>\bin` 里 `.CMD` + `.ps1` 并排，
    // 宿主在同机 PATH 上（判据只认二进制形态的 pwsh/powershell）。
    const dir = makeInstalledPnpmDir();
    const hostDir = makePowerShellHost(path.join(tmp, "host"));
    const env = {
      PATH: `${dir}${path.delimiter}${hostDir}`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    const args = ["exec", "next", "dev", "--turbo", "-p", "3734"];
    const inv = pnpmInvocation(args, { env, platform: "win32" });
    expect(inv, "PATH 上有可用形态时必须给出调用方式").not.toBeNull();
    /* **不钉「选中了哪一个文件」**，只钉「选中的是那个目录里真有的形态、且经宿主起」。原先写死 `candidate === pnpm.CMD`
     * 只在 POSIX 成立（Windows 实测红）：`.PS1` 无条件进候选后（ISSUE #1961）顺序成 `"" → .EXE → .PS1 → .CMD`，而
     * Windows 查找不分大小写，目录里的 `pnpm.ps1` 会被 `pnpm.PS1` 命中。两条路最终同落 PowerShell 宿主，差别只是
     * 先命中哪个文件；**按大小写不敏感比**是因为 `whichCommand()` 交出的是按 `PATHEXT` 拼的候选、只在 Windows 上由
     * `onDiskName()` 回写实际写法，直接 `toContain` 等于又留一格「盘上怎么写决定结论」的断言。 */
    const selected = inv!.candidate.toLowerCase();
    expect(
      [path.join(dir, "pnpm.CMD"), path.join(dir, "pnpm.ps1")].map((p) => p.toLowerCase()),
      `选中的不是那个目录里真有的形态：${inv!.candidate}`,
    ).toContain(selected);
    expect(inv!.viaHost).toBe(true);
    expect(inv!.args.slice(-args.length)).toEqual(args);
    // 与既有判据同源：命令形态必须等于 commandInvocation 的结论
    const reference = commandInvocation(path.join(dir, "pnpm.CMD"), ["-v"], {
      env,
      platform: "win32",
    });
    expect(inv!.command).toBe(reference.command);
    expect(inv!.command).toBe(path.join(hostDir, "pwsh.EXE"));
  });

  it("PATH 上没有可用 pnpm 时返回 null（调用方必须给可见出口，不许静默 0）", () => {
    const dir = makeWindowsPnpmDir({});
    expect(
      pnpmInvocation([], { env: WIN_ENV(dir), platform: "win32" }),
      "一个可跑形态都没有时必须显式 null",
    ).toBeNull();
  });

  needsPosixExec("POSIX 上不退化为 pnpm.cmd（判据不按平台分叉）", () => {
    const dir = makeWindowsPnpmDir({ shim: "working" });
    const inv = pnpmInvocation(["dev"], {
      env: { PATH: dir },
      platform: "linux",
    });
    expect(inv).not.toBeNull();
    expect(inv!.command).toBe(path.join(dir, "pnpm"));
  });

  it("dev.mjs / start.mjs 不再各自拼 pnpm 可执行名", () => {
    for (const rel of ["scripts/dev.mjs", "scripts/start.mjs"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel}: 必须复用 pnpmInvocation`).toContain("pnpmInvocation");
      // 写死平台后缀的旧写法必须消失（它是这条缺陷的形态本身）
      expect(src, `${rel}: 不得再写死 pnpm.cmd`).not.toContain('"pnpm.cmd"');
      expect(src, `${rel}: 不得再按平台三元表达式拼可执行名`).not.toMatch(/win32"\s*\?\s*"pnpm/);
    }
  });

  /**
   * 全仓范围：**任何**由 Node 起 pnpm 的地方都经同一处形态判据（ISSUE #638）。前一格只钉三个服务类入口，`check-format.cjs`、
   * `build-desktop.mjs` 等没进清单，同坑遂复发：`[format] ... spawnSync pnpm.cmd EINVAL` —— 那里写着 `win32 ? "pnpm.cmd" : "pnpm"`
   * （§2.1.1 判定的起不来形态），且 `format:ratchet` 在 `check:all` 里。故按**形态**扫：`pnpm.cmd` 字面量、平台三元名、裸 spawn/exec pnpm。
   */
  it("全仓 scripts/**：由 Node 起 pnpm 一律经 shell.mjs 的形态判据", () => {
    const offenders: Array<string> = [];
    const walk = (dir: string): Array<string> => {
      const out: Array<string> = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (["node_modules", "__pycache__"].includes(e.name)) {
            continue;
          }
          out.push(...walk(full));
        } else {
          out.push(full);
        }
      }
      return out;
    };

    for (const abs of walk(path.join(ROOT, "scripts"))) {
      if (!/\.(?:mjs|cjs|ts)$/.test(abs)) {
        continue;
      }
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      // 判据模块自己：它必须写出这些形态（否则「起不来」这件事无法被表达）。
      if (rel === "scripts/launcher-core/shell.mjs") {
        continue;
      }
      const raw = fs.readFileSync(abs, "utf8");
      // 注释里会**引用**旧写法作反面说明，判据只看代码（与 dev.mjs 那条同口径）。
      // **块注释也要剥**：`/** … */` 里的举例会被逐行扫成「真写了这句」
      // （`scripts/ci-cp936-exit.mjs` 头注里就有 `spawn("pnpm")` 这种反面举例，
      // 只剥 `//` 会让本判据把它判成违规）。先剥 `/* … */` 再剥行注释。
      const code = stripComments(raw, { trailing: true });

      // ① 写死平台后缀 / 按平台三元拼可执行名 —— 形态本身就是缺陷。
      if (/"pnpm\.cmd"|'pnpm\.cmd'/.test(code)) {
        offenders.push(`${rel}: 写死了 pnpm.cmd`);
      }
      if (/win32"?\s*\?\s*"pnpm/.test(code)) {
        offenders.push(`${rel}: 按平台三元拼 pnpm 可执行名`);
      }

      // ② 裸 spawn/exec 一个 pnpm 名字（无论有没有扩展名）而没走同一处判据。
      //    `runPnpmSync` / `pnpmInvocation` 是**唯一**被允许的起 pnpm 的方式。
      const usesShared = /pnpmInvocation|runPnpmSync/.test(code);
      const spawnsByName =
        /(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(\s*["'`]pnpm/i.test(code);
      if (spawnsByName && !usesShared) {
        offenders.push(`${rel}: 直接起 pnpm —— 必须复用 pnpmInvocation / runPnpmSync`);
      }
    }

    expect(
      offenders,
      `这些文件自己在拼 pnpm 可执行名（Windows 上会选中 Node 起不来的批处理形态）：\n${offenders
        .map((o) => `  · ${o}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("dev.mjs：spawn 失败（命令起不来）必须非零退出，且把 error.code 与真实命令打出来", () => {
    const raw = fs.readFileSync(path.join(ROOT, "scripts", "dev.mjs"), "utf8");
    // 注释里会**引用**旧写法作反面说明，判据只看代码：先剥掉行注释（共享件，#2969 收敛）。
    const code = stripComments(raw, { trailing: true });
    expect(code).toContain("result.error");
    /* 「把 code 打出来」钉在**失败块那一段**，而不是整份文件的子串：原本断字面量 `result.error.code`，而它判的是语义
     * ——「那条失败路径必须报出错误码」。脚本侧把那一位收成局部变量后，整档搜子串就红在一个**没变过的行为**上
     * （ISSUE #2589 批 1 现场）。收窄到块内保留原意，也不再被邻近改写牵动；反面那半（不许 `?? 0` 吞掉）仍在下。
     */
    const failureBlock = code.slice(
      code.indexOf("if (result.error)"),
      code.indexOf("if (result.status === null)"),
    );
    expect(
      failureBlock.length,
      "认不出失败块（那两段 `if` 的形状变了）—— 这条用例此刻没有判任何东西",
    ).toBeGreaterThan(0);
    expect(failureBlock, "失败块里必须把 error 的 code 打出来").toContain(".code");
    expect(code).toContain("实际命令：");
    // 旧写法 `process.exit(result.status ?? 0)` 把「没起来」读成成功 —— 必须分开判。
    expect(code, "不得再出现 ?? 0 吞掉「没起来」").not.toMatch(/exit\(result\.status\s*\?\?\s*0\)/);
    expect(code, "status 为 null 必须与非零退出分开").toContain("result.status === null");
  });
});

/**
 * 一次启动里 `pnpm -v` 只探一次（ISSUE #1516）：日志里「端口检查」到「pnpm 版本匹配」之间空了 2.77s —— 那不是编排在算，而是
 * **第二次 spawnSync 冷启 pnpm shim**（工具链门禁 `orchestratePnpm` 刚问过，稍后 `reconcilePnpmVersion` 又原样问一遍）；Windows 上
 * corepack shim 经 node 中转单次 1~3s，等于白付两遍。判据是「问几次」而非「多快」：计数脚本当 pnpm，去掉 `probeMemo` 立刻变 2 次。
 */
describe("pnpm 探测的记忆化（一次启动只探一次）", () => {
  /** 造一个「每次被 spawn 就往计数文件追加一行」的假 pnpm。 */
  function makeCountingPnpm(dirName: string, body: string) {
    const dir = path.join(tmp, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const counter = path.join(tmp, `${dirName}-calls.txt`);
    const script = path.join(dir, "pnpm");
    // 逐行拼装，避免源码里出现跨行的字符串字面量。
    const lines = ["#!/bin/sh", `echo x >> "${counter}"`, body, ""];
    fs.writeFileSync(script, lines.join("\n"));
    fs.chmodSync(script, 0o755);
    return {
      dir,
      calls: () =>
        fs.existsSync(counter)
          ? fs.readFileSync(counter, "utf8").split("\n").filter(Boolean).length
          : 0,
    };
  }

  needsPosixExec("同一环境问两次只 spawn 一次", () => {
    const { dir, calls } = makeCountingPnpm("count-a", "echo 12.4.1");
    const env = { PATH: dir };
    const first = probePnpm({ env, platform: "linux" });
    const afterFirst = calls();
    const second = probePnpm({ env, platform: "linux" });
    expect(first.ok).toBe(true);
    expect(second.version).toBe("12.4.1");
    /* 判据是「第二次有没有多起一次进程」，而不是绝对次数：`whichCommand` 自己也会
     * 真起一次候选来验可用性（见 executable-resolve 的记忆化注释）。绝对次数会随
     * 那张缓存的实现漂，而「再问一遍 = 不再 spawn」正是要钉的契约。 */
    expect(calls(), "第二次必须命中缓存、不再 spawn").toBe(afterFirst);
  });

  needsPosixExec("同一环境下返回的就是同一个结论对象（快照式取用）", () => {
    const { dir } = makeCountingPnpm("count-b", "echo 12.4.1");
    const env = { PATH: dir };
    const first = probePnpm({ env, platform: "linux" });
    expect(probePnpm({ env, platform: "linux" })).toBe(first);
  });

  needsPosixExec("失败结论同样被记住（坏掉的 pnpm 不必问第二遍）", () => {
    const dir = path.join(tmp, "count-c");
    fs.mkdirSync(dir, { recursive: true });
    // 首行 shebang 指向不存在的解释器：脚本根本起不来（spawn-error 一档）。
    const script = path.join(dir, "pnpm");
    fs.writeFileSync(script, ["#!/nonexistent/sh", "exit 0", ""].join("\n"));
    fs.chmodSync(script, 0o755);
    const env = { PATH: dir };
    const first = probePnpm({ env, platform: "linux" });
    const second = probePnpm({ env, platform: "linux" });
    expect(first.ok).toBe(false);
    expect(second.reason).toBe(first.reason);
    expect(second).toBe(first);
  });

  needsPosixExec("换 PATH 就是另一个问题：不许互相顶掉结论", () => {
    const a = makeCountingPnpm("count-d", "echo 12.4.1");
    const b = makeCountingPnpm("count-e", "echo 9.9.9");
    expect(probePnpm({ env: { PATH: a.dir }, platform: "linux" }).version).toBe("12.4.1");
    expect(probePnpm({ env: { PATH: b.dir }, platform: "linux" }).version).toBe("9.9.9");
  });

  needsPosixExec("换 root 也是另一个问题（键里带 root）", () => {
    const { dir } = makeCountingPnpm("count-f", "echo 12.4.1");
    const otherRoot = path.join(tmp, "other-root");
    fs.mkdirSync(otherRoot, { recursive: true });
    const env = { PATH: dir };
    const first = probePnpm({ root: tmp, env, platform: "linux" });
    const second = probePnpm({ root: otherRoot, env, platform: "linux" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(probePnpm({ root: tmp, env, platform: "linux" })).toBe(first);
    expect(probePnpm({ root: otherRoot, env, platform: "linux" })).toBe(second);
  });

  it("prepare 之前必须弃用缓存：它换的就是 pnpm 的激活版本", () => {
    // 判据是「调用顺序」而不是「结果」：prepare 若在 spawn 之后才清缓存，
    // 复核拿到的就是准备之前的结论。源码级断言（真实 prepare 要联网下载）。
    const raw = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "corepack.mjs"),
      "utf8",
    );
    const body = raw.slice(raw.indexOf("export function preparePnpm"));
    const clearAt = body.indexOf("clearPnpmProbeCache()");
    const spawnAt = body.indexOf("spawnSync(command");
    expect(clearAt, "preparePnpm 必须显式弃用探测缓存").toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(-1);
    expect(clearAt, "弃用必须发生在 spawn **之前**").toBeLessThan(spawnAt);
  });

  it("拿不到 corepack 时 prepare 只回说明，不抛错（缓存不改变这条契约）", () => {
    const result = preparePnpm({
      root: ROOT,
      env: { PATH: tmp },
      platform: "linux",
    });
    expect(result.ran).toBe(false);
    expect(typeof result.description).toBe("string");
  });
});
/**
 * 「同一问题在链路里只问一次」（ISSUE #1687）：0.46s 不是「端口空了还查后面」（+1/+2 是 Next 静默顺延的探测位），而是壳自编排
 * （单实例 + 端口族）后编排器接手又走一遍。边界：① 自编排链路里编排器**不再起第二个壳**（标记「本次编排由壳拉起」，§1.5）；
 * ② 端口判据（含回收残留）**仍必须每次跑**（壳只认互斥量、从不碰端口）；标记缺席（手工 `pnpm dev`）照常起壳、照常查。
 */
describe("启动期重复判定的短路（ISSUE #1687）", () => {
  /* 自编排那一段的实现随 R5 拆刀（ISSUE #1811）搬进了
   * `launcher-core/shell-stage.mjs`：判据是**接线形态**（标记怎么判、哪一支不起壳），
   * 不是「这段写在哪份文件里」，所以走现算的链路闭包。 */
  const launcher = launcherChainSource();
  const rust = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "shell_launch.rs"), "utf8");

  it("自编排链路里编排器不再起第二个壳", () => {
    // 判据是壳注入的标记（键名与壳侧 `spawn_orchestrator` 同源），且只对
    // prebuilt 成立。
    expect(launcher).toContain("const launchedByShell =");
    expect(launcher).toContain('process.env.COMFYAPP_SHELL_SELF_LAUNCH === "1"');
    expect(launcher).toContain('mode === "prebuilt"');
    /* 不起壳那一支必须真的跳过 spawnShell。R5 拆刀（ISSUE #1811）把它重整成**提前返回**（`if (launchedByShell) {
     * …; return { ok: true, shell: null, staleShell }; }`），不再用 `} else {` 分叉 —— 所以要看**从分支开始到它的
     * return**，用 `} else {` 去切会一路吃到文件尾。返回形状的 `ok: true` 是拆刀补上的（与另一支对齐），按实际形态断言。
     */
    const skipStart = launcher.indexOf("if (launchedByShell) {");
    expect(skipStart, "找不到自编排分支（拆刀后别断了接线）").toBeGreaterThan(-1);
    const skipEnd = launcher.indexOf("return { ok: true, shell: null, staleShell };", skipStart);
    expect(skipEnd, "自编排分支要提前返回、不再往下走").toBeGreaterThan(-1);
    const skipBody = launcher.slice(skipStart, skipEnd);
    expect(skipBody, "自编排分支不许再 spawn 壳").not.toContain("spawnShell(");
    expect(skipBody, "要说清为什么不起壳").toContain("不再起第二个壳");
    // 标记不许再注入给任何壳 / dev server：不会再有「被编排器起的壳」。
    expect(launcher).not.toContain('COMFYAPP_SHELL_SELF_LAUNCH: "1"');
  });

  it("壳起编排器时注入自编排标记，键名与编排器侧同一处", () => {
    expect(rust).toContain('.env("COMFYAPP_SHELL_SELF_LAUNCH", "1")');
  });

  it("端口族残留回收不受自编排影响（reconcilePort 必须始终跑）", () => {
    const body = launcher.slice(
      launcher.indexOf("let portSummary"),
      launcher.indexOf('status("port-ready"'),
    );
    expect(
      body,
      "reconcilePort 始终运行：壳的单实例判据只认互斥量、从不碰端口，跳过它会撞上一次残留的 dev server",
    ).toContain("await reconcilePort(port, ROOT, {");
    expect(
      body,
      "不再有按 launchedByShell 跳过端口判据的分支（ISSUE #1687 的「只问一次」前提不含历史残留）",
    ).not.toContain("if (launchedByShell)");
  });

  it("壳侧单实例判定不再有「被编排器起的壳」短路", () => {
    const lib = fs.readFileSync(path.join(ROOT, "src-tauri", "src", "lib.rs"), "utf8");
    const body = lib.slice(
      lib.indexOf("fn another_instance_owns_this_checkout"),
      lib.indexOf("fn another_instance_owns_this_checkout") + 1500,
    );
    expect(body, "任何壳都照常判单实例").toContain("single_instance::another_instance_running()");
    expect(lib, "「被编排器起的壳」形态已随第二个壳一起移除").not.toContain("is_shell_child");
  });
});

import {
  checkDeclaredFloor,
  collectDependencyFloors,
  parseRange,
  satisfies,
} from "../scripts/node-engines.mjs";

/**
 * Node 下限这一格存在的理由（规范 §2.1.8）：`next` 的下限（`>=20.9.0`）比测试链低得多 ⇒「Node 太旧」的表现是
 * **开发链路全绿、只有用例档炸**（`Cannot find module` 一类、指不出该换版本），旧 README「Node ≥ 22」比 jsdom 的
 * `^22.22.2` 还松。判据是**本仓声明 ⊆ 每个依赖声明**（`next` 无上界，方向反了永不成立）；`>=24.15.0` 亦不合法（允许 25.x）。
 */
describe("Node 下限：engines.node 必须被每个依赖自己声明的范围接受", () => {
  const scanned = collectDependencyFloors(ROOT);
  /** @type {Array<{pkg: string, range: string}>} */
  const floors = scanned.ok ? scanned.floors : [];

  it("扫描面非空，且点名三条测试链依赖（「零命中」不能长得像「谁都不挑 Node」）", () => {
    expect(scanned.ok, "依赖下限没取到").toBe(true);
    const names = floors.map((f) => f.pkg);
    expect(names).toEqual(expect.arrayContaining(["vitest", "jsdom", "msw"]));
    expect(names.length).toBeGreaterThan(10);
  });

  it("本仓声明的范围满足每一条依赖下限（真算，不是比字符串）", () => {
    const r = checkDeclaredFloor({ root: ROOT, floors });
    expect(r.ok, `被越过的依赖：${r.gaps?.map((g) => g.pkg).join(", ")}`).toBe(true);
  });

  it("README 的环境要求与 engines.node 同源（防文档漂回「≥ 22」那种松写法）", () => {
    const declared = checkDeclaredFloor({ root: ROOT, floors }).range;
    expect(declared).toBeTruthy();
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const line = readme.split("\n").find((l) => l.includes("**Node.js**"));
    expect(line, "README 里那行 Node 要求不见了").toBeDefined();
    expect(line).toContain(declared);
  });

  /* ── 反向证明：这格不承重的话，它就是装饰 ────────────────────────── */

  it("把声明放宽到 next 的下限 ⇒ 必须点名被越过的测试链依赖", () => {
    const r = checkDeclaredFloor({ root: ROOT, declared: ">=20.9.0", floors });
    expect(r.ok).toBe(false);
    expect(r.gaps?.map((g) => g.pkg)).toEqual(expect.arrayContaining(["vitest", "jsdom", "msw"]));
  });

  it("无上界的 `>=24.15.0` 同样不合法（它放进了依赖不接受的 25.x）", () => {
    const r = checkDeclaredFloor({ root: ROOT, declared: ">=24.15.0", floors });
    expect(r.ok).toBe(false);
    expect(r.gaps?.map((g) => g.pkg)).toEqual(expect.arrayContaining(["vitest", "jsdom"]));
  });

  it("读不懂的形状判「没跑起来」，不判绿", () => {
    expect(checkDeclaredFloor({ root: ROOT, declared: "20.x" }).kind).toBe("unparsable");
    expect(parseRange("20.x")).toBeNull();
    /* 空字符串与缺失也走同一格 —— 「没声明」不能读成「没有下限要求」。 */
    expect(checkDeclaredFloor({ root: ROOT, declared: "" }).kind).toBe("missing");
  });

  it("形状解析覆盖真实出现的三种写法：操作符后带空格、一档内并排两个比较符、并集", () => {
    /* `@tauri-apps/cli` 写 `>= 10`、`@sentry/nextjs` 写 `>=22.12.0 <23.0.0`：
     * 这两条不是假数据，是 node_modules 里现装的形状。 */
    expect(satisfies("24.20.0", ">= 10")).toBe(true);
    expect(satisfies("22.11.0", ">=22.12.0 <23.0.0")).toBe(false);
    expect(satisfies("22.12.0", ">=22.12.0 <23.0.0")).toBe(true);
    expect(satisfies("23.0.0", ">=22.12.0 <23.0.0")).toBe(false);
    expect(satisfies("25.0.0", "^22.22.2 || ^24.15.0 || >=26.0.0")).toBe(false);
    expect(satisfies("22.22.1", "^22.22.2 || ^24.15.0 || >=26.0.0")).toBe(false);
    expect(satisfies("22.22.2", "^22.22.2 || ^24.15.0 || >=26.0.0")).toBe(true);
  });

  (envWithPnpm() ? it : it.skip)(
    "check:toolchain 在低版本 Node 下 WARN 并点名坏的是哪一档，但退出码仍 0",
    () => {
      const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
        {
          encoding: "utf8",
          env: { ...(envWithPnpm() ?? process.env), COMFYAPP_NODE_VERSION: "v20.9.0" },
        },
      );
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
      expect(r.stdout).toContain("不在声明范围内");
      expect(r.stdout).toContain("坏的是测试档");
      /* 建议必须给「最近的可达档」：engines.node 收紧成 `>=26.12.1`（#2531）后，
       * 唯一的可达档就是 26.12.1 本身 —— 曾经的 `^22.22.2 || …` 时代才会建议 22。 */
      expect(r.stdout).toContain("建议升到 26.12.1");
    },
  );

  (envWithPnpm() ? it : it.skip)(
    "依赖下限采集没跑起来 ⇒ 念采集器的 reason，不把「没跑起来」印成「在声明范围内」（ISSUE #2722）",
    () => {
      /* 临时根：有 engines.node 与依赖声明、**没有 node_modules** —— 硬规则 26 的场景
       * （还没 install 就自查）。修复前：采集失败被折成空数组 ⇒ 那一格打 [OK] 在声明
       * 范围内；修复后：WARN 带采集器的 reason（「一个依赖的 package.json 都没解析到」）。 */
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toolchain-no-modules-"));
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          engines: { node: ">=26.12.1" },
          dependencies: { "some-pkg": "1.0.0" },
        }),
        "utf8",
      );
      const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "check-pnpm-available.mjs"), "--deps-root", tmp],
        { encoding: "utf8", env: envWithPnpm() ?? process.env },
      );
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
      expect(r.status, `stdout=${r.stdout ?? ""} stderr=${r.stderr ?? ""}`).toBe(0);
      expect(r.stdout).toContain("Node 下限这条判据没跑起来");
      expect(r.stdout).toContain("依赖没装");
      expect(r.stdout).not.toContain("在声明范围内");
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  );
  (envWithPnpm() ? it : it.skip)("当前 Node 合规时打 OK 行（这句是上面那格的对照组）", () => {
    /* 本条的输入是「这一跑真的起的那个 node」，所以它**不能**注入
     * `COMFYAPP_NODE_VERSION`：上一格（低版本 Node 那一档）把它写进了宿主环境，
     * 而 `envWithPnpm()` 是 `{ ...process.env }` —— 照搬过来就变成「用 v20.9.0 判
     * 合规」，本条会在 CI 上以 `expected 1 to be 0` 红。显式清掉它。 */
    const env: NodeJS.ProcessEnv = {
      ...(envWithPnpm() ?? process.env),
    };
    delete env.COMFYAPP_NODE_VERSION;
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-pnpm-available.mjs")],
      { encoding: "utf8", env },
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 起不来时 stdout/stderr 实测为 undefined，@types/node 按非空标，空串兜底保留
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    expect(r.stdout).toContain("在声明范围内");
  });
});
