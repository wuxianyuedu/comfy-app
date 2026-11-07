/**
 * GA 桌包档「桌面成品构建」那一格（ISSUE #3305）：`pnpm tauri build` 的
 * `beforeBuildCommand` 是 `node scripts/build-desktop.mjs`，它跑在一个 Node 子进程里，
 * 而 `pnpm/action-setup` 装在临时 dest、PNPM_HOME 指向 .bin —— PATH 上只有 npm 生成的
 * 垫片（shebang / .cmd / .ps1），Node 按名字找的形态判据够不着真身 `pnpm-native.exe`
 * （名字不在 PATH × 扩展名的候选集里，见 ci-install-deps.mjs 的 shimPnpm 头注）。
 *
 * 这一族在 GA 上红过两轮，两轮红点不同（ISSUE #3305）：
 *   ① 第一轮：build-desktop 用 `pnpmInvocation()` 按名字找，在 `beforeBuildCommand` 的
 *      Node 子进程里返回 null ⇒ 当场 fail。修法是收口到 `pnpmCli()`，与 daily 生产构建
 *      同一份判据。
 *   ② 第二轮：`pnpmCli()` 仍回落裸 `pnpm` ⇒ ENOENT。根因是 workflow 那一格用
 *      `bin_dest` 拼父目录猜真身目录，而 bootstrap 12.17.0 ≠ 本仓钉的 12.4.1 ⇒
 *      action-setup 走 `self-update`，`bin_dest` 实为 `.bin/bin`，拼出来的是 `.bin/pnpm`
 *      这个**垫片文件**；`Test-Path` 对文件也返回真 ⇒ 补 PATH 那一格假绿。
 *
 * 所以这一份钉住：① 源码形态不许回潮；② 真实 `dest` 语义下（真身在
 * `<dest>/node_modules/pnpm/pnpm.exe`）补 PATH 后 `pnpmCli` 命中绝对路径；
 * ③ `.bin/pnpm` 那种垫片文件形状补进 PATH 时拿不到绝对路径，且失败读数把
 * 「问过哪几处」逐条念全（不再只给一句「没找到」）；④ workflow 那一格读 `dest`
 * 输出、真起一次 `-v`，不再靠 `Test-Path` 假绿。
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pnpmCli } from "../scripts/ci-install-deps.mjs";
import { pnpmInvocation } from "../src/lib/process/pnpm-resolve.ts";
import { stripComments } from "./helpers/strip-comments";

const SCRIPT = join(process.cwd(), "scripts", "build-desktop.mjs");

describe("build-desktop 与 daily 生产构建同用一份 pnpm 形态判据（ISSUE #3305）", () => {
  it("源码里不再按名字找 pnpm，改用 ci-install-deps 的 pnpmCli", () => {
    // 判**代码**：注释里解释「旧形态为什么够不着」的话不该被读成回潮。
    const code = stripComments(readFileSync(SCRIPT, "utf8"), { trailing: true });
    expect(code, "回到了按名字找 pnpm 的旧形态").not.toContain("pnpmInvocation(");
    expect(code).toContain('import { pnpmCli } from "./ci-install-deps.mjs"');
    // 两处派生（1/4 pnpm build / DDL 导出）都经 pnpmCli，不落下一个。
    expect([...code.matchAll(/pnpmCli\(\)/g)].length).toBe(2);
  });

  it("有 corepack 落点时 pnpmCli 拿到绝对路径，而按名字找判没有；纯垫片形态不硬 fail", () => {
    /* readDir 要返回真 `Dirent[]`（B5 不许写 `as never` 那类断言）⇒ 用系统临时目录
     * 造一个真实的 `12.4.1/` 子目录，让它读真盘。用例结束即清。 */
    const versionRoot = mkdtempSync(join(tmpdir(), "ga-pnpm-ver-"));
    mkdirSync(join(versionRoot, "12.4.1"));
    /* 不写真盘：ensurePnpmOnPath 的注入面用 `exists` / `spawn` 回答「盘上有什么、
     * 起不起得来」。corepack 落点对准 %LOCALAPPDATA%/node/corepack/v1/pnpm/<ver>/，
     * 与 ci-install-deps.test.ts 同一套形状。 */
    const local = join("C:", "Users", "runneradmin", "AppData", "Local");
    const bin = join("D:", "a", "_temp", "setup-pnpm", "node_modules", ".bin");
    const store = join(local, "node", "corepack", "v1", "pnpm");
    const verDir = join(store, "12.4.1");
    const native = join(verDir, "pnpm-native.exe");
    const shim = join(bin, "pnpm");
    // 展开 process.env 让类型天然是 ProcessEnv（NODE_ENV 等键在场），
    // 再覆盖注入面关心的那几个 —— 不写 `as`（B5 的 no-unsafe-type-assertion
    // 对新代码零容忍，不许按文件挂账）。
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin};C:\\Windows\\System32`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      LOCALAPPDATA: local,
      USERPROFILE: join("C:", "Users", "runneradmin"),
    };

    // 按名字找：PATH 上只有垫片 ⇒ 真身 pnpm-native.exe 不在候选集 ⇒ null（桌包红）
    const byName = pnpmInvocation(["build"], { env, platform: "win32" });
    expect(byName, "按名字找不该在这种形态下判成功").toBeNull();

    // pnpmCli：真起一次 -v 的注入探针只认那个全路径，交出它
    const files: Record<string, { ok: boolean }> = {
      [shim]: { ok: false },
      [native]: { ok: true },
    };
    const cli = pnpmCli({
      platform: "win32",
      env,
      exists: (p: string) => files[p] !== undefined || [local, store, verDir].includes(p),
      readDir: (p: string) =>
        p === store ? readdirSync(versionRoot, { withFileTypes: true }) : [],
      spawn: (cmd: string) => {
        const hit = files[cmd];
        if (!hit) return { status: null, stdout: "", stderr: "", error: "ENOENT" };
        return hit.ok
          ? { status: 0, stdout: "12.4.1\n", stderr: "", error: null }
          : { status: 1, stdout: "", stderr: "usage", error: null };
      },
      write: () => undefined,
      publish: () => null,
    });
    expect(cli.resolved).toBe(true);
    expect(cli.command).toBe(native);
    expect(cli.prefixArgs).toEqual([]);

    /* 纯 action-setup 形态（把 corepack 落点从盘上摘掉）：pnpmCli 拿不到绝对路径，
     * 但**退回裸名字 `pnpm`** 交给 spawnSync 的宿主解析面（与 daily 生产构建同形），
     * 而不是像 pnpmInvocation 那样判 null 让调用方当场 fail。 */
    const bare = pnpmCli({
      platform: "win32",
      env,
      exists: (p: string) =>
        p === bin || p === shim || p === join(bin, "pnpm.cmd") || p === join(bin, "pnpm.ps1"),
      readDir: () => [],
      spawn: () => ({ status: null, stdout: "", stderr: "", error: "ENOENT" }),
      write: () => undefined,
      publish: () => null,
    });
    expect(bare.resolved).toBe(false);
    expect(bare.command).toBe("pnpm");
    expect(bare.prefixArgs).toEqual([]);
    rmSync(versionRoot, { recursive: true, force: true });
  });

  it("GA 真实 dest 语义下：补 <dest>/node_modules/pnpm 才命中，垫片文件形状拿不到", () => {
    /* 决定性证据按 action-setup@v6 的**实测落点**造形状：`dest` 是安装根，
     * `<dest>/node_modules/pnpm/pnpm.exe` 是 pnpm 12 原生二进制，而 `bin_dest`
     * 在 self-update 后是 `<dest>/node_modules/.bin/bin`（bootstrap 12.17.0，
     * 本仓 packageManager 钉 12.4.1）。上一轮拿 `bin_dest` 的父目录拼出
     * `.bin/pnpm` —— 那是 npm 生成的垫片**文件**，不是目录。 */
    const dest = join("D:", "a", "_temp", "setup-pnpm");
    const pkgDir = join(dest, "node_modules", "pnpm");
    const bin = join(dest, "node_modules", ".bin");
    const binBin = join(bin, "bin");
    const exe = join(pkgDir, "pnpm.exe");
    const shim = join(bin, "pnpm");
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      LOCALAPPDATA: join("C:", "Users", "runneradmin", "AppData", "Local"),
      USERPROFILE: join("C:", "Users", "runneradmin"),
    };
    /** 按仓里判据的读法模拟真盘：`ensurePnpmOnPath` 在 win32 下用 path.join 拼候选。 */
    const probe = (pathEntries: string[], present: string[], works: string) => {
      const env: NodeJS.ProcessEnv = { ...baseEnv, PATH: pathEntries.join(";") };
      const logs: string[] = [];
      const cli = pnpmCli({
        platform: "win32",
        env,
        exists: (p: string) =>
          present.some((x) => x.replaceAll("/", "\\") === p.replaceAll("/", "\\")),
        readDir: () => [],
        spawn: (cmd: string) =>
          cmd.replaceAll("/", "\\") === works.replaceAll("/", "\\")
            ? { status: 0, stdout: "12.4.1\n", stderr: "", error: null }
            : { status: null, stdout: "", stderr: "", error: "ENOENT" },
        write: (line: string) => logs.push(line),
        publish: () => null,
      });
      return { cli, logs: logs.join("") };
    };

    // ① 修复前：PATH 上只有 action-setup 自己加的 .bin / .bin/bin 垫片 ⇒ 回落裸名字
    const before = probe([binBin, bin, String.raw`C:\Windows\System32`], [shim], "");
    expect(before.cli.resolved).toBe(false);
    expect(before.cli.command).toBe("pnpm");
    expect(before.logs).toContain("逐条见下");
    expect(before.logs).toContain("PATH 条目");

    // ② 上一轮的错误推导：把 .bin/pnpm（垫片文件）当目录补进 PATH ⇒ 仍拿不到
    const wrong = probe([shim, binBin, bin, String.raw`C:\Windows\System32`], [shim], "");
    expect(wrong.cli.resolved).toBe(false);
    expect(wrong.cli.command).toBe("pnpm");

    // ③ 正解：把 <dest>/node_modules/pnpm 补进 PATH，pnpm.exe -v 真起得来 ⇒ 绝对路径
    const fixed = probe([pkgDir, binBin, bin, String.raw`C:\Windows\System32`], [exe, shim], exe);
    expect(fixed.cli.resolved).toBe(true);
    expect(fixed.cli.command).toBe(exe);
    expect(fixed.cli.prefixArgs).toEqual([]);
  });

  it("workflow 补 PATH 那一格读 dest 输出、真起 -v，不再靠 Test-Path 假绿", () => {
    const yml = readFileSync(
      join(process.cwd(), ".github", "workflows", "package-desktop.yml"),
      "utf8",
    );
    const step = yml.slice(
      yml.indexOf("- name: 把 pnpm 真身目录补进 PATH"),
      yml.indexOf("- name: NSIS 工具镜像缓存"),
    );
    expect(step).toContain("steps.setup-pnpm.outputs.dest");
    expect(step).toContain("PathType Container");
    expect(step).toContain("pnpm.exe");
    expect(step).toContain("-v");
    // 候选顺序：self-update 落点在前（版本与 packageManager 一致），bootstrap 真身兜底
    expect(step.indexOf("$env:PNPM_BIN_DEST")).toBeLessThan(
      step.indexOf("Join-Path $env:PNPM_DEST"),
    );
    expect(step, "不许再从 bin_dest 拼父目录猜真身落点").not.toContain(
      "Split-Path $env:PNPM_BIN_DEST -Parent",
    );
  });
});
