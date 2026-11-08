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
import { afterAll, describe, expect, it } from "vitest";
/* POSIX 宿主探针改由 fixture 提供（`tests/helpers/platform-fixtures.ts`）——
 * 原来本文件自己写了一份 `posixHost()`，与 `kill-process-tree` 那边同形。
 * fixture 版是同一份实现，改一处两边都动。 */
import { test as platformTest } from "../../../tests/helpers/platform-fixtures";

import {
  executableExts,
  executableKind,
  pnpmInvocation,
  pnpmJsEntry,
  resolveCommandInvocation,
  usableCommand,
  whichCommand,
  type UsabilityProbe,
} from "./executable-resolve";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exec-resolve-"));
let seq = 0;
/** 每个用例一个独立目录：同名文件被覆写重造不会串到别的用例（`whichCommand` 不再记忆化）。 */
function freshDir(): string {
  const dir = path.join(tmp, `case-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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
    cmd?: boolean;
    host?: boolean;
    ps1?: boolean;
    shim?: boolean;
  } = {},
) {
  if (opts.shim !== false) {
    writeExec(path.join(dir, name), "#!/usr/bin/env node\nconsole.log('1.0.0')\n");
  }
  if (opts.cmd !== false) {
    writeExec(path.join(dir, `${name}.CMD`), "@ECHO off\r\n@SETLOCAL\r\n");
  }
  if (opts.ps1 !== false) {
    writeExec(path.join(dir, `${name}.ps1`), "Write-Output '1.0.0'\n");
  }
  if (opts.host === true) {
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
  it("可打印 ASCII 起头的脚本判 `script`，长度不限于 2（ISSUE #2563）", () => {
    /* 判据读的是**最多 16 字节**的文件头，而量词曾写成 `{2}`（= 恰好两个字符）
     * ⇒ 只有长度恰好 2 的文件才算脚本，其余全被判成 `binary`。长度 2 / 3 / 16
     * 三档都要是 `script`：把量词改回 `{2}`，后两档立刻红。 */
    const dir = freshDir();
    const bodies = [
      "ab",
      "abc",
      'process.stdout.write("x");\n',
      "#!/usr/bin/env node\n", // 这一档由 `#!` 那一支先接走，此处只是对照组
    ];
    const kinds = bodies.map((body, i) => {
      const file = path.join(dir, `s${i}.js`);
      fs.writeFileSync(file, body);
      return executableKind(file);
    });
    expect(kinds[0]).toBe("script");
    expect(kinds[1]).toBe("script");
    expect(kinds[2]).toBe("script");
    expect(kinds[3]).toBe("shebang");
  });

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
  platformTest("POSIX：PATH 上找到就用绝对路径（这就是那条 ENOENT 的解法）", ({ makeHost }) => {
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
  });

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

  it("⚠️ 探针**不拿调用方的 `args` 去起** —— 解析不等于把这条命令先跑一遍", () => {
    /* ISSUE #1977 第八轮。上一层判「这个候选起不起得来」的方式是**真起一次**，而它
     * 喂的参数此前正是本函数的第二入参 —— 于是「调用方要跑什么」与「探针喂什么」
     * 被合成了一件东西，**探针把真命令整条跑了一遍**：
     *
     *   `resolveCommandInvocation("node", ["scripts/e2e-run.mjs", "--grep=@critical"])`
     *   ⇒ 探针真的起了一次 e2e-run（拉 Playwright 的 webServer、假 ComfyUI），
     *   而 `spawnSync` 超时**只收直接子进程** —— 孙子进程留在端口上接着跑。
     *   `.cnb.yml` 里每条 `node scripts/…` / `pnpm run build` 因此都被执行两遍。
     *
     * 这一条**不注入 `probe`**（注入面自己会把这条缺陷抹平）：真起一次，拿一个
     * 「跑起来会留下痕迹」的脚本当那条命令 —— 痕迹在 = 探针真跑了它。
     */
    const dir = freshDir();
    const marker = path.join(dir, "ran.log");
    const script = path.join(dir, "commands.mjs");
    fs.writeFileSync(
      script,
      "import fs from 'node:fs';\n" +
        `fs.appendFileSync(${JSON.stringify(marker)}, "EXECUTED\\n");\n`,
    );
    const r = resolveCommandInvocation("node", [script, "--some-real-flag"], {
      env: { PATH: process.env.PATH ?? "" },
      platform: process.platform,
    });
    /* 解析本身照旧成立，参数一个字节不改写。 */
    expect(r.resolved).toBe(true);
    expect(r.args).toEqual([script, "--some-real-flag"]);
    /* **判据**：真命令没有被执行过。反向复算：把探针参数换回 `args`（旧写法）时
     * 这个文件立刻出现。 */
    expect(fs.existsSync(marker)).toBe(false);
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
  platformTest("前一个目录里的同名候选没有执行位 → 跳过去找后面那个能跑的", ({ makeHost }) => {
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
  });

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

  platformTest("记忆化按 env 分键：换 PATH 必须换结论（不许串扰）", ({ makeHost }) => {
    const a = freshDir();
    const b = freshDir();
    const binA = path.join(a, "tool");
    writeExec(binA, "#!/bin/sh\necho a\n");
    const probe = makeHost([binA]);
    expect(whichCommand("tool", { env: { PATH: a }, platform: "linux", probe })).toBe(binA);
    // b 里没有这个命令 —— 若缓存只看名字，这里会错误地回 a 的路径。
    expect(whichCommand("tool", { env: { PATH: b }, platform: "linux", probe })).toBeNull();
  });
});

/**
 * `env` 可能是 `{ ...process.env }` 的**复制品**，而 Windows 的键常写成 `Path`
 * （ISSUE #1961，平台侧 E2E 的最后一格）。
 *
 * 现场：同一次构建里 `Python 探针读数` 报
 * `ok python → D:\Program Files\Python312\python.exe`（它读的是 `process.env`
 * 这个**大小写不敏感的代理**），而 `E2E 关键流程` 报「PATH 上没有可用的 Python」
 * —— 它的 `env` 来自 `{ ...process.env }`（普通对象、键是 `Path`）。
 * 差的正是「读的是代理还是复制品」，而不是「这台机有没有 Python」。
 *
 * 判据按**目标平台**判（`platform: "win32"`），与 `executableExts()` 同口径：
 * 它跑在 POSIX 上，`process.platform` 不是被测的那一个。
 */
describe("whichCommand：环境变量的键大小写（Windows 的 `Path`）", () => {
  /** 只看候选名、不真起进程 —— `access` 与 `spawn` 都放行。 */
  function passthrough(): UsabilityProbe {
    return { access: () => undefined, spawn: () => null };
  }

  it("win32：键写成 `Path` 时也找得到（复制品的形态）", () => {
    const dir = freshDir();
    const exe = path.join(dir, "tool.EXE");
    writeExec(exe, "#!/bin/sh\nexit 0\n");
    expect(
      whichCommand("tool", {
        env: { Path: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        platform: "win32",
        probe: passthrough(),
      }),
    ).toBe(exe);
  });

  it("win32：键写成 `PATH` 时同样找得到（对照组，不许反过来红）", () => {
    const dir = freshDir();
    const exe = path.join(dir, "tool.EXE");
    writeExec(exe, "#!/bin/sh\nexit 0\n");
    expect(
      whichCommand("tool", {
        env: { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        platform: "win32",
        probe: passthrough(),
      }),
    ).toBe(exe);
  });

  it("POSIX 上大小写**是**要紧的：`Path` 不算 `PATH`（这一层不改 POSIX 行为）", () => {
    const dir = freshDir();
    writeExec(path.join(dir, "tool"), "#!/bin/sh\nexit 0\n");
    expect(
      whichCommand("tool", {
        env: { Path: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        platform: "linux",
        probe: passthrough(),
      }),
    ).toBeNull();
  });
});

/**
 * `pnpmInvocation()` 的第一优先是**包真身的 JS 入口**（ISSUE #2562）。
 *
 * 现场：Windows 上 `pnpm` 那三个垫片里 Node 一个都起不来（无扩展名是 shebang、`.cmd`
 * 是批处理 ⇒ `EINVAL`，与 Node 版本无关），于是唯一能走的路是 `.ps1` 经 PowerShell 宿主
 * —— 一次启动里十来条 `pnpm …` 就付十来次 PowerShell 冷启动。而**包真身就摆在旁边**：
 * `spawn(process.execPath, [<入口>, …])` 全平台同一条路、`shell: false` 恒定、不要宿主。
 *
 * 这几条盯三件事，缺一条这个形态就会退化回宿主：
 *   ① 入口**从包的 `bin` 字段读**（不猜文件名），两种 `bin` 形状都接得住；
 *   ② 选出来的是 `process.execPath` + 入口，`viaHost === false`；
 *   ③ 包真身不在 / `bin` 指向原生二进制时**老实落回**「直接起可执行形态」。
 */
describe("pnpmInvocation：优先跑包真身的 JS 入口（ISSUE #2562）", () => {
  /** 造一个带包真身的 pnpm 落点。`bin` 用字符串形态（corepack 那一形）。 */
  function writePnpmPackage(dir: string, opts: { bin: unknown; entry?: string }) {
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    fs.mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", version: "12.4.1", bin: opts.bin }),
    );
    const entry = path.join(pkgDir, opts.entry ?? "bin/pnpm.cjs");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    writeExec(entry, 'process.stdout.write("12.4.1\\n");\n');
    return { pkgDir, entry };
  }

  it("bin 是字符串：读它、用 process.execPath 起，不经宿主", () => {
    const dir = freshDir();
    const { entry } = writePnpmPackage(dir, { bin: "./bin/pnpm.cjs" });
    // PATH 上同时摆着垫片：选中 JS 入口意味着**连垫片都不起**
    writeExec(path.join(dir, "pnpm"), "#!/bin/sh\nexit 0\n");
    expect(pnpmJsEntry(dir)).toBe(entry);
    /* `platform` 用**宿主**的：判据里的 `path.join` 按宿主分隔符拼候选，写死 `"linux"`
     * 在 Windows 上会拼出「反斜杠目录 + 正斜杠文件名」这种两不像的路径 —— 那是
     * 「产物形状依赖跑判据那台机」，不是被测逻辑（同文件那些 Windows 形态的用例
     * 靠注入 `isFile` 绕开同一件事）。这一条判的是「两平台都走 JS 入口」。 */
    const inv = pnpmInvocation(["install"], { env: { PATH: dir } });
    expect(inv, "包真身在的时候必须给出形态").not.toBeNull();
    expect(inv!.command).toBe(process.execPath);
    expect(inv!.args).toEqual([entry, "install"]);
    expect(inv!.viaHost, "JS 入口不需要宿主").toBe(false);
  });

  it("bin 是对象：取键 `pnpm` 那一条（pnpm 12 的 bin 形状）", () => {
    const dir = freshDir();
    const { entry } = writePnpmPackage(dir, {
      bin: { pnpm: "bin/pnpm.cjs", pnpx: "bin/pnpx.cjs" },
    });
    expect(pnpmJsEntry(dir)).toBe(entry);
  });

  it("bin 指向原生二进制：改用同包的 Corepack 入口 bin/pnpm.mjs", () => {
    /* pnpm 11+ 把 `bin` 写成 `{ "pnpm": "pnpm" }`，那个文件是 MZ / ELF。拿
     * `process.execPath` 去起它就是 `SyntaxError: Invalid or unexpected token`；
     * 而 Corepack 对 pnpm ≥ 11 写死的入口 `bin/pnpm.mjs` 就在同一个包里。 */
    const dir = freshDir();
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    fs.mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", bin: { pnpm: "pnpm" } }),
    );
    // 原生二进制的最小复刻：MZ 头 + 一串不可打印字节
    fs.writeFileSync(
      path.join(pkgDir, "pnpm"),
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    );
    const mjs = path.join(pkgDir, "bin", "pnpm.mjs");
    writeExec(mjs, "#!/usr/bin/env node\nprocess.stdout.write('12.4.1');\n");
    expect(pnpmJsEntry(dir)).toBe(mjs);
  });

  it("bin 指向 Corepack 的**占位文件**（首行是 `#` 注释）：不算入口，改用 bin/pnpm.mjs", () => {
    /* 本机现场（ISSUE #2597）：`%LOCALAPPDATA%\node\corepack\v1\pnpm\<ver>\` 里
     * `package.json` 的 `bin.pnpm` 指向同目录那个 `pnpm` —— 那一份在 `install.js`
     * 跑过之前只是**占位文本**，第一行是一条 `#` 注释（不是 shebang）。
     * `executableKind()` 只看「可打印 ASCII」把它判成 `script`，于是选中它 ⇒
     * 每一条 pnpm 形态的门禁退 1（`SyntaxError`），并被上游误读成「判据红了」。 */
    const dir = freshDir();
    const pkgDir = path.join(dir, "node_modules", "pnpm");
    fs.mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", bin: { pnpm: "pnpm" } }),
    );
    fs.writeFileSync(
      path.join(pkgDir, "pnpm"),
      "# pnpm's native binary replaces this file during installation.\n" +
        "# Until then this hands over to ./bin/pnpm.mjs.\n",
    );
    const mjs = path.join(pkgDir, "bin", "pnpm.mjs");
    writeExec(mjs, "#!/usr/bin/env node\nprocess.stdout.write('12.4.1');\n");
    expect(pnpmJsEntry(dir)).toBe(mjs);
    /* 占位文件**单独**放在落点上时也不能被选中 —— 否则回退那一条 for 根本走不到。 */
    const bare = freshDir();
    fs.mkdirSync(path.join(bare, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(bare, "package.json"),
      JSON.stringify({ name: "pnpm", bin: { pnpm: "pnpm" } }),
    );
    fs.writeFileSync(path.join(bare, "pnpm"), "# not a shebang, not JS\nfoo\n");
    expect(pnpmJsEntry(bare)).toBeNull();
  });

  it("落点自己就是那个包（corepack 的 <ver> 目录）：也算数", () => {
    /* `corepack enable` 之后 PATH 上那个 `…/corepack/v1/pnpm/<ver>/` **本身**就是
     * 解开的 pnpm 包根 —— 少了这一形，Windows 上就只剩 `.ps1` 那条路。 */
    const root = freshDir();
    fs.mkdirSync(path.join(root, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "pnpm", bin: "./bin/pnpm.cjs" }),
    );
    const entry = path.join(root, "bin", "pnpm.cjs");
    writeExec(entry, 'process.stdout.write("12.4.1\\n");\n');
    expect(pnpmJsEntry(root)).toBe(entry);
  });

  it("没有包真身：返回 null，落回「直接起可执行形态」（不许凭空造入口）", () => {
    /* 这一格判的是**落回**，不是「落回时选中了哪个文件」—— 后者由形态判据
     * （`whichCommand` / `usableCommand`）决定，而它在一台真实 Windows 上不会选中
     * `#!` 脚本（libuv 不解析 shebang）。所以只断言「入口这一层不造东西」+
     * 「`pnpmInvocation` 仍给出了形态、且没走 JS 入口那条路」。 */
    const dir = freshDir();
    writeExec(path.join(dir, "pnpm"), "#!/bin/sh\nexit 0\n");
    expect(pnpmJsEntry(dir)).toBeNull();
    const inv = pnpmInvocation(["install"], { env: { PATH: dir } });
    // 「没走 JS 入口」= 起的那条命令不是 `process.execPath` + `node_modules` 里的入口
    if (inv) {
      expect(inv.command).not.toBe(process.execPath);
    }
  });

  it("PATH 上只有垫片、包真身在本机落点上：仍走 JS 入口（不退回宿主）", () => {
    /* Windows 现场的形态：PATH 上是 corepack 的三个垫片，包真身在
     * `%LOCALAPPDATA%\pnpm\node_modules\pnpm\`。这一格必须在**没有 PATH 命中**时也成立，
     * 否则 `pnpmInvocation` 会退回 `.ps1` 宿主那一跳。 */
    const bin = freshDir();
    writeExec(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(bin, "pnpm.CMD"), "@ECHO off\r\necho 12.4.1\r\n");
    const home = freshDir();
    const home2 = freshDir();
    const localAppData = freshDir();
    const dropIn = path.join(localAppData, "pnpm");
    const pkgDir = path.join(dropIn, "node_modules", "pnpm");
    fs.mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pnpm", bin: "./bin/pnpm.cjs" }),
    );
    const entry = path.join(pkgDir, "bin", "pnpm.cjs");
    writeExec(entry, 'process.stdout.write("12.4.1\\n");\n');
    const inv = pnpmInvocation(["install"], {
      env: {
        PATH: bin,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        LOCALAPPDATA: localAppData,
        USERPROFILE: home,
        HOME: home2,
      },
      platform: "win32",
    });
    expect(inv!.command).toBe(process.execPath);
    expect(inv!.args).toEqual([entry, "install"]);
    expect(inv!.viaHost).toBe(false);
  });
});

/**
 * 解析结果**不跨调用共享**（ISSUE #3327）。
 *
 * 此前模块级 `Map` 把每次解析的产物写进同一张表，另一次「按名字查」的调用会把它读回来：
 * 既会读到过期值（PATH 上的文件在本进程存活期间被删 / 重造），也构成一条进程内通道
 * （扫描器据此把一次调用当成另一次的源）。去掉记忆化后每次调用都现扫 PATH，下面四条钉的是
 * 「合法值照旧、旧值不再复用、探针换了立即生效」。
 */
describe("whichCommand：每次调用现解析（不再有进程内记忆化）", () => {
  /** 只看候选名、不真起进程 —— `access` 与 `spawn` 都放行。 */
  function passthrough(): UsabilityProbe {
    return { access: () => undefined, spawn: () => null };
  }

  it("合法值照旧：PATH 上唯一的候选就是返回的绝对路径", () => {
    const dir = freshDir();
    const exe = path.join(dir, "tool");
    writeExec(exe, "#!/bin/sh\nexit 0\n");
    expect(
      whichCommand("tool", { env: { PATH: dir }, platform: "linux", probe: passthrough() }),
    ).toBe(exe);
  });

  it("同名、同 PATH、文件已删：第二次不再读回第一次的旧路径", () => {
    const dir = freshDir();
    const exe = path.join(dir, "tool");
    writeExec(exe, "#!/bin/sh\nexit 0\n");
    const env = { PATH: dir };
    expect(whichCommand("tool", { env, platform: "linux", probe: passthrough() })).toBe(exe);
    fs.rmSync(exe);
    /* 旧实现的记忆化键只有 name + PATH + PATHEXT + platform ⇒ 这里会读回已删掉的旧路径。 */
    expect(whichCommand("tool", { env, platform: "linux", probe: passthrough() })).toBeNull();
  });

  it("换探针不再需要先清缓存：同一条 PATH 上一次通过、一次拒绝", () => {
    const dir = freshDir();
    writeExec(path.join(dir, "tool"), "#!/bin/sh\nexit 0\n");
    const env = { PATH: dir };
    expect(whichCommand("tool", { env, platform: "linux", probe: passthrough() })).not.toBeNull();
    /* 旧实现的键里不含 probe ⇒ 这一格会读到上一条的「可用」结论。 */
    expect(
      whichCommand("tool", {
        env,
        platform: "linux",
        probe: { access: () => undefined, spawn: () => "ENOEXEC" },
      }),
    ).toBeNull();
  });

  it("已删除的落点不会以旧值再进 `spawn` 的参数（resolveCommandInvocation）", () => {
    const dir = freshDir();
    const exe = path.join(dir, "tool");
    writeExec(exe, "#!/bin/sh\nexit 0\n");
    const options = { env: { PATH: dir }, platform: "linux" as const, probe: passthrough() };
    expect(resolveCommandInvocation("tool", [], options)).toEqual({
      command: exe,
      args: [],
      resolved: true,
    });
    fs.rmSync(exe);
    /* 找不到就退回裸名字（交给 OS 按名字解析），而不是上一次解析出的绝对路径。 */
    expect(resolveCommandInvocation("tool", [], options)).toEqual({
      command: "tool",
      args: [],
      resolved: false,
    });
  });
});
