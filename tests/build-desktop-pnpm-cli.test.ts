/**
 * GA 桌包档「桌面成品构建」那一格（ISSUE #3305）：`pnpm tauri build` 的
 * `beforeBuildCommand` 是 `node scripts/build-desktop.mjs`，它跑在一个 Node 子进程里，
 * 而 `pnpm/action-setup` 装在临时 dest、PNPM_HOME 指向 .bin —— PATH 上只有 npm 生成的
 * 垫片（shebang / .cmd / .ps1），Node 按名字找的形态判据够不着真身 `pnpm-native.exe`
 * （名字不在 PATH × 扩展名的候选集里，见 ci-install-deps.mjs 的 shimPnpm 头注）。
 *
 * `daily` 的「生产构建」格经 `artifact-run.mjs` → `runPnpmSync(command: pnpmCli())`
 * 在 GA 上已验证 success，而 build-desktop 曾是唯一还按名字找的那个。两处的关键差别
 * 不是「谁找到了绝对路径」：`pnpmCli()` 在纯 action-setup 形态（PATH 上只有 npm 的
 * `pnpm` / `.cmd` / `.ps1` 垫片、无 corepack 落点）下同样拿不到绝对路径，但它是**退回
 * 裸名字 `pnpm` 交给 spawnSync 的宿主解析面**，而不是像 `pnpmInvocation()` 那样返回
 * null 直接 fail —— daily 那格正是靠这一条在 GA 上跑通的。所以这一份钉住：
 *   ① 源码形态收口到 pnpmCli，不许回潮；
 *   ② 有 corepack 落点时 pnpmCli 确实比按名字找强（拿到可 spawn 的绝对路径）；
 *   ③ 纯垫片形态下 pnpmInvocation 判没有、pnpmCli 不硬 fail（失败由调用方 spawn 报）。
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

  it("GA workflow 把 pnpm 真身目录补进 PATH 后，pnpmCli 命中绝对路径（不需裸名兜底）", () => {
    /* 这一条是修复能成立的**决定性证据**：package-desktop.yml 新增那一格把
     * action-setup 的 `<dest>/node_modules/pnpm`（pnpm 12 原生 pnpm.exe 所在目录）
     * 追加到 GITHUB_PATH。补过之后 `ensurePnpmOnPath` 第 1 步在 PATH 上真起
     * `pnpm.exe -v` 成功 ⇒ pnpmCli 交出绝对路径，build-desktop 直接 spawnSync 它，
     * 不再依赖「裸 pnpm 经宿主解析面能不能起」这个平台相关的假设。 */
    const dest = join("D:", "a", "_temp", "setup-pnpm");
    const pkgDir = join(dest, "node_modules", "pnpm");
    const bin = join(dest, "node_modules", ".bin");
    const exe = join(pkgDir, "pnpm.exe");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${pkgDir};${bin};C:\\Windows\\System32`,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      LOCALAPPDATA: join("C:", "Users", "runneradmin", "AppData", "Local"),
      USERPROFILE: join("C:", "Users", "runneradmin"),
    };
    const cli = pnpmCli({
      platform: "win32",
      env,
      exists: (p: string) => p === exe,
      readDir: () => [],
      spawn: (cmd: string) =>
        cmd === exe
          ? { status: 0, stdout: "12.4.1\n", stderr: "", error: null }
          : { status: null, stdout: "", stderr: "", error: "ENOENT" },
      write: () => undefined,
      publish: () => null,
    });
    expect(cli.resolved).toBe(true);
    expect(cli.command).toBe(exe);
    expect(cli.prefixArgs).toEqual([]);
  });
});
