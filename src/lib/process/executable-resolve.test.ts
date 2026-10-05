/**
 * 可执行形态判据的单测（ISSUE #1327 起从 `scripts/launcher-core/shell.mjs` 搬来）。
 *
 * 起点是那条现场：应用内控制台里跑 `pnpm exec tsc --noEmit`，回
 * 「无法启动命令：spawn pnpm ENOENT」—— 因为 `console-run.ts` 把用户敲的
 * `pnpm` 直接交给了 `spawn`，而 Windows 上 Node 的 `spawn` 不认 PATHEXT。
 *
 * 本文件因此盯**控制台真正踩到的那几档**，而不是把 launcher 侧的用例整份搬过来
 * （那 39 条仍在 `tests/dev-launcher-toolchain-gate.test.ts`，钉的是启动编排的
 * 视角：探测 / 回退 / `pnpm -v`）。这里只判「给控制台一个用户敲的名字，它能不能
 * 拿到一个真起得来的形态」，以及「拿不到时调用方能不能给出可读出口」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
/* POSIX 宿主探针改由 fixture 提供（`tests/helpers/platform-fixtures.ts`）——
 * 原来本文件自己写了一份 `posixHost()`，与 `kill-process-tree` 那边同形。
 * fixture 版是同一份实现，改一处两边都动。 */
import { test as platformTest } from "../../../tests/helpers/platform-fixtures";

import {
  clearWhichCommandCache,
  executableExts,
  executableKind,
  resolveCommandInvocation,
  usableCommand,
  whichCommand,
  type UsabilityProbe,
} from "./executable-resolve";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exec-resolve-"));
let seq = 0;
/** 每个用例一个独立目录：同一个 tmp 路径被覆写重造会让记忆化缓存说谎。 */
function freshDir(): string {
  const dir = path.join(tmp, `case-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  clearWhichCommandCache();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const WIN_ENV = (dir: string) => ({
  PATH: dir,
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
});

/** 造一个能被 Node 起起来的可执行文件（POSIX 上要执行位，Windows 上 X_OK 恒通过）。 */
function writeExec(file: string, content: string) {
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}

/** 有执行位、但这台机器的内核起不来的形态（没有 `#!` 行的纯文本脚本）。 */
function unusableKind(): UsabilityProbe {
  return { access: () => undefined, spawn: () => "ENOEXEC" };
}

/** corepack 在 Windows 上的三种形态并排：无扩展名 shim + `.cmd` + `.ps1`。 */
function makeWindowsToolchain(
  dir: string,
  name: string,
  opts: {
    shim?: boolean;
    cmd?: boolean;
    ps1?: boolean;
    host?: boolean;
  } = {},
) {
  if (opts.shim !== false) {
    writeExec(
      path.join(dir, name),
      "#!/usr/bin/env node\nconsole.log('1.0.0')\n",
    );
  }
  if (opts.cmd !== false) {
    writeExec(path.join(dir, `${name}.CMD`), "@ECHO off\r\n@SETLOCAL\r\n");
  }
  if (opts.ps1 !== false) {
    writeExec(path.join(dir, `${name}.ps1`), "Write-Output '1.0.0'\n");
  }
  if (opts.host) {
    // `powershellHost()` 只认二进制形态（MZ 头）。
    writeExec(
      path.join(dir, "pwsh.EXE"),
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]).toString("latin1"),
    );
  }
  return dir;
}

describe("executableExts：候选顺序即判据", () => {
  it("POSIX 只有一种形态（无扩展名）", () => {
    expect(executableExts({ PATH: "/usr/bin" }, "linux")).toEqual([""]);
  });

  it("Windows：无扩展名 / .EXE 优先，.PS1 次之，.CMD 垫底", () => {
    const exts = executableExts(WIN_ENV("/x"), "win32");
    expect(exts[0]).toBe("");
    expect(exts.indexOf(".PS1")).toBeLessThan(exts.indexOf(".CMD"));
  });
});

describe("executableKind：读内容形态，不看扩展名", () => {
  it("`#!` 开头判 shebang（corepack 的无扩展名 shim）", () => {
    const dir = freshDir();
    const f = path.join(dir, "pnpm");
    writeExec(f, "#!/usr/bin/env node\n");
    expect(executableKind(f)).toBe("shebang");
  });

  it("`@echo` 开头判 batch（Node 起不了它 —— 只有 cmd.exe 会解释）", () => {
    const dir = freshDir();
    const f = path.join(dir, "pnpm.CMD");
    writeExec(f, "@ECHO off\r\n");
    expect(executableKind(f)).toBe("batch");
  });

  it("MZ 头判 binary", () => {
    const dir = freshDir();
    const f = path.join(dir, "pwsh.EXE");
    writeExec(f, Buffer.from([0x4d, 0x5a, 0x90, 0x00]).toString("latin1"));
    expect(executableKind(f)).toBe("binary");
  });
});

describe("resolveCommandInvocation：控制台起进程前的那一问", () => {
  platformTest(
    "POSIX：PATH 上找到就用绝对路径（这就是那条 ENOENT 的解法）",
    ({ makeHost }) => {
      const dir = freshDir();
      const bin = path.join(dir, "mytool");
      writeExec(bin, "#!/bin/sh\necho ok\n");
      const r = resolveCommandInvocation("mytool", ["--flag"], {
        env: { PATH: dir },
        platform: "linux",
        probe: makeHost([bin]),
      });
      expect(r.resolved).toBe(true);
      expect(r.command).toBe(bin);
      expect(r.args).toEqual(["--flag"]);
    },
  );

  it("查无此命令：不改写、`resolved: false`（调用方据此给可读出口）", () => {
    const dir = freshDir();
    const r = resolveCommandInvocation("definitely-not-here", ["-v"], {
      env: { PATH: dir },
      platform: "linux",
    });
    expect(r).toEqual({
      command: "definitely-not-here",
      args: ["-v"],
      resolved: false,
    });
  });

  it("Windows：`.cmd` 垫底、选中经 PowerShell 宿主的 `.ps1` 形态", () => {
    const dir = freshDir();
    // 只有 .cmd 与 .ps1 并排（corepack 装出来的现场），且宿主可用。
    makeWindowsToolchain(dir, "pnpm", { shim: false, host: true });
    const r = resolveCommandInvocation("pnpm", ["-v"], {
      env: WIN_ENV(dir),
      platform: "win32",
    });
    expect(r.resolved).toBe(true);
    // 经宿主：command 是 pwsh，脚本路径在参数里。
    expect(r.command).toBe(path.join(dir, "pwsh.EXE"));
    expect(r.args).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(dir, "pnpm.ps1"),
      "-v",
    ]);
  });

  it("Windows：`.cmd` 没有 `.ps1` 回退也没有宿主 → 判「PATH 上没有可用形态」", () => {
    const dir = freshDir();
    makeWindowsToolchain(dir, "pnpm", { shim: false, ps1: false, host: false });
    const r = resolveCommandInvocation("pnpm", ["-v"], {
      env: WIN_ENV(dir),
      platform: "win32",
    });
    /* 这是**刻意**的结论：`whichCommand` 只认「真的能跑」的候选，`.cmd` 单独存在
     * 时它一个都不认（Node 起不了批处理），于是回 `resolved: false`。
     * 对用户的意义是控制台会回「找不到命令 pnpm（已在 PATH 上查找，没有可用形态）」
     * —— 比 `spawn pnpm ENOENT` 有用得多：它说清了「找过了、没找到能起的那个」，
     * 而不是让用户去猜是不是参数写错。 */
    expect(r.resolved).toBe(false);
    expect(r.command).toBe("pnpm");
  });
});

describe("whichCommand：只认「真的能跑」的候选", () => {
  platformTest(
    "前一个目录里的同名候选没有执行位 → 跳过去找后面那个能跑的",
    ({ makeHost }) => {
      /* 「扫到一个同名文件」不等于「能跑」—— 这条判据存在的全部理由。两个目录都在
       * PATH 上，前一个里的 `mytool` 没执行位（POSIX 上是常态：装了一半、软链指错），
       * 按「见到就用」就会把一个起不来的路径交出去，而调用方只会看到一句新的错。 */
      const dirA = freshDir();
      const dirB = freshDir();
      const noPerm = path.join(dirA, "mytool");
      const runnable = path.join(dirB, "mytool");
      writeExec(noPerm, "#!/bin/sh\necho a\n");
      writeExec(runnable, "#!/bin/sh\necho b\n");
      expect(
        whichCommand("mytool", {
          env: { PATH: [dirA, dirB].join(path.delimiter) },
          platform: "linux",
          probe: makeHost([runnable]),
        }),
      ).toBe(runnable);
    },
  );

  platformTest(
    "候选存在但不可执行：判否，返回 null（不许返回一个注定失败的路径）",
    ({ makeHost }) => {
      const dir = freshDir();
      const bin = path.join(dir, "mytool");
      writeExec(bin, "#!/bin/sh\n");
      expect(
        whichCommand("mytool", {
          env: { PATH: dir },
          platform: "linux",
          probe: makeHost([]),
        }),
      ).toBeNull();
    },
  );

  platformTest(
    "「没执行权限」与「形态起不来」是两句不同的话（排查方向完全不一样）",
    ({ makeHost }) => {
      /* 前者是 chmod / 软链 / 挂载选项这一类本机配置问题，后者是「Node 起不了这个形态」
       * ——混成一句就会把人带去修错的地方，所以 reason 要分开报。 */
      const dir = freshDir();
      const noPerm = path.join(dir, "x");
      writeExec(noPerm, "#!/bin/sh\n");
      expect(
        usableCommand(noPerm, ["-v"], {
          platform: "linux",
          probe: makeHost([]),
        }).reason,
      ).toBe("no-exec-permission");

      const badKind = path.join(dir, "y");
      writeExec(badKind, "print('没有 #! 行，也不是本机认得的形态')\n");
      const reported = usableCommand(badKind, ["-v"], {
        platform: "linux",
        probe: unusableKind(),
      });
      expect(reported.ok).toBe(false);
      expect(reported.reason).toBe("ENOEXEC");
    },
  );

  platformTest(
    "记忆化按 env 分键：换 PATH 必须换结论（不许串扰）",
    ({ makeHost }) => {
      const a = freshDir();
      const b = freshDir();
      const binA = path.join(a, "tool");
      writeExec(binA, "#!/bin/sh\necho a\n");
      const probe = makeHost([binA]);
      expect(
        whichCommand("tool", { env: { PATH: a }, platform: "linux", probe }),
      ).toBe(binA);
      // b 里没有这个命令 —— 若缓存只看名字，这里会错误地回 a 的路径。
      expect(
        whichCommand("tool", { env: { PATH: b }, platform: "linux", probe }),
      ).toBeNull();
    },
  );
});
