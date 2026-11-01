/**
 * 回归护栏：**跨平台启动编排**（ISSUE #489，「启动全链路 + Tauri v2 壳改跨平台」）。
 *
 * 背景（实测）：全项目 11 个 scripts 下的 .ps1 + 29 个 tools 下的 .ps1，唯一的
 * 启动编排者 `dev-launcher.ps1`（1324 行 / 19 处 Windows 专属：`taskkill` /
 * `Get-CimInstance` / Job Object / `cmd.exe`）在 Linux / macOS 上不可用，而仓库里
 * **没有任何等价入口**。也就是说「跨平台」这一侧此前不是漏了几个平台判断，
 * 而是根本没有实现。
 *
 * 本用例钉死三条契约（都做了反向验证：还原旧实现，对应用例必失败）：
 *   1. `dev-launcher.mjs` 起的 dev server **自建进程组**，收尾能整组回收 ——
 *      不建组时 `killProcessTree` 只能单杀 leader，其下的 node/pnpm 残留成孤儿
 *      （AGENTS 硬规则 3 禁止的形态，且这正是上一轮 PR #500 修过又被真实进程树
 *      推翻的地方）。
 *   2. 会话锚点（PID + 心跳）能分辨「上一次的启动器还活着」与「它已死、留下孤儿」，
 *      且**不由 PID 是否存在单独决定**（PID 会被系统复用）。
 *   3. `.next` 缓存指纹只覆盖构建配置；指纹变化才清缓存（源码改动交给 HMR）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyProbe,
  configFingerprint,
  latestPanelTranscript,
  readDiagnosticsTail,
  reapStaleSession,
  scanPorts,
  spawnInGroup,
  syncNextCache,
} from "../scripts/dev-launcher.mjs";
import {
  HEARTBEAT_STALE_MS,
  clearSession,
  isSessionOwnerAlive,
  readSession,
  touchHeartbeat,
  writeSession,
} from "../scripts/dev-launcher-session.mjs";
import { killProcessTree } from "../src/lib/process/kill-process-tree";
import { stripComments as stripJs } from "./helpers/strip-comments";
import { launcherChainSource } from "./helpers/launcher-source";

/**
 * 读一份源文件并**剥掉注释**（唯一实现 `./helpers/strip-comments`，`{trailing:true}` 连行尾一起去）。
 *
 * 为什么这一族的反向断言必须先剥：`scripts/launcher-core/shell.mjs` 里就有一句
 * 「写着 `process.platform === "win32" ? "pnpm.cmd" : "pnpm"`。那条判据在 Windows 上…」——
 * 拿原文去判「编排器不许自己摸 platform」，就会红在**正在解释为什么不该这么写**的那行文档上。
 *
 * 为什么不用这份文件里 `describe` 内那一份本地 `stripComments`（`scripts 里的 src/lib 路径字面量`
 * 那一组里）：那份是台账登记的另一型（`tests/strip-comments-single-source.test.ts`），
 * 它只服务那一组的说明符扫描，换语言面不同 —— 引它的名字会构成第二份定义。
 *
 * ⚠️ 刻意**不**用在 `#` 注释语法上的那两份接收者：`scripts/dev-launcher.ps1` 与
 * `src-tauri/Cargo.toml`。实测拿 JS 档剥 `.ps1` 前后字符数完全相同（2898 → 2898，等于没剥），
 * 而那一格自己的口径写着「判据是『不再调用』而不是『不再提及』」—— 加上去只会造出假红。
 * 那一格缺口归 ISSUE #2934，不在这里补。
 */
const readCode = (rel: string): string =>
  stripJs(fs.readFileSync(path.join(process.cwd(), rel), "utf8"), { trailing: true });

/** 数出「进程组」里还剩几个活着的标记进程（用唯一标记匹配命令行）。 */
function countMarkedProcesses(marker: string): number {
  const out = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
  return out.split("\n").filter((line: string) => line.includes(marker) && !line.includes("ps -eo"))
    .length;
}

/**
 * 等一个条件成立 —— 用 `expect.poll` 而不是手搓 `while + await setTimeout`（规范 §11.14）。
 *
 * 手搓版本失败时只留一个 `false`、拿不到现场，而这里等的是**真进程动作**
 * （`spawn` 落地、孙进程被 taskkill 收走）：失败时最该看到的就是当时还剩下
 * 哪几个 PID，那正是 `expect.poll` 会打出来的实际值。判据是「等的是一个条件」，
 * 所以两边都读同一个 `check`：先轮询等它成立，再把**最终读数**交回调用点
 * （调用点自己仍用 `toBe(true)` 判结论，报错文案里保留各自的语义）。
 */
async function waitUntil(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  await expect.poll(check, { timeout: timeoutMs, interval: 100 }).toBe(true);
  return check();
}

describe("跨平台启动编排（dev-launcher.mjs）", () => {
  const tmpDirs: Array<string> = [];

  function makeTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfyapp-launcher-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("端口扫描覆盖本端口与 +1/+2（Next 会静默顺延，邻位要一起看）", () => {
    expect(scanPorts(3311)).toEqual([3311, 3312, 3313]);
  });

  // 本用例真起 POSIX 进程组（`sh` + `ps -eo` 数残留）：Windows 上既没有 `sh` 也没有
  // `ps`，跑起来只会得到 spawn ENOENT 这种与判据无关的红。Windows 那一侧由
  // `src/lib/process/kill-process-tree.windows.test.ts` 真跑（断言 taskkill 参数形态）。
  it.skipIf(process.platform === "win32")(
    `进程组回收真跑：spawnInGroup 起的进程树被杀完不留孤儿`,
    async () => {
      // 目标：一条带两个子进程的 shell —— 单杀 leader 会留下这两个子进程。
      const marker = `comfyapp-tree-${Date.now()}`;
      const child = spawnInGroup({
        command: "sh",
        args: ["-c", `sh -c 'sleep 60 # ${marker}' & sh -c 'sleep 60 # ${marker}' & wait`],
        cwd: process.cwd(),
      });
      expect(await waitUntil(() => countMarkedProcesses(marker) >= 3, 8000)).toBe(true);

      const result = await killProcessTree({ pid: child.pid!, detached: true });
      expect(result.ok).toBe(true);
      // 「整组」是判据：信号落到 -pgid，而不只是 leader。
      expect(result.via).toContain("进程组");

      expect(await waitUntil(() => countMarkedProcesses(marker) === 0, 8000)).toBe(true);
    },
    20_000,
  );

  // Windows 上 taskkill 是独立进程：回收入口「派发完就 exit」会被父进程的退出一起
  // 带走，现象是**打印了命令、退出码 0、目标进程却还在**（实测）。这里真起一个长命
  // 进程、真跑 `node scripts/reap-process.mjs <pid> --force`，再核实它**真的没了** ——
  // 只断言「打印了命令」恰恰是这条兜底静默失效的原因。POSIX 分支是一次同步
  // `process.kill`，不存在这个窗口，故只在 Windows 上跑。
  it.skipIf(process.platform !== "win32")(
    "reap-process.mjs 真的收掉目标进程（Windows：派发完不能立刻退出）",
    async () => {
      const child = spawnInGroup({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
        cwd: process.cwd(),
      });
      const pid = child.pid;
      expect(pid).toBeGreaterThan(0);

      const out = execFileSync(
        process.execPath,
        [path.join("scripts", "reap-process.mjs"), String(pid), "--force"],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(out).toContain(String(pid));

      const gone = await waitUntil(() => {
        try {
          process.kill(pid!, 0);
          return false;
        } catch {
          return true;
        }
      }, 8000);
      expect(gone).toBe(true);
    },
    20_000,
  );

  it("会话锚点：心跳新鲜 + PID 存活才算「上一位还活着」", () => {
    const root = makeTmp();
    expect(isSessionOwnerAlive(root)).toBe(false); // 没有会话 = 不算活着

    const session = {
      launcher_pid: process.pid,
      /* SAFETY: 类型断言已复核 */
      child_pids: [] as Array<number>,
      app_port: 3311,
      mode: "web",
      started_at: new Date().toISOString(),
    };
    writeSession(root, session);
    touchHeartbeat(root);
    expect(isSessionOwnerAlive(root)).toBe(true);

    // 心跳陈旧（超过阈值）= 上一位卡死/被杀 → 必须判定为「已死」，
    // 否则孤儿永远回收不了。这正是「只判 PID 是否存在」会漏掉的形态。
    touchHeartbeat(root, Date.now() - HEARTBEAT_STALE_MS - 1000);
    expect(isSessionOwnerAlive(root)).toBe(false);

    // 心跳新鲜但 PID 不存在（写完心跳立刻被杀）同样算死。
    touchHeartbeat(root);
    writeSession(root, { ...session, launcher_pid: 0x7f_ff_ff_fe });
    expect(isSessionOwnerAlive(root)).toBe(false);

    clearSession(root);
    expect(readSession(root)).toBeNull();
  });

  // 会话锚点是「上一次没走优雅收尾」的必然残留：壳收编排器走的是
  // `Child.kill()`（TerminateProcess），编排器没有清理机会。此时它的子树早已被
  // 插件 kill / Job Object 收干净 —— 回收这一步只该清锚点，不该报「回收了 PID …」
  // （那既是噪声，旧号被系统复用时还会误伤无关进程）。
  it("回收上一次的残留：子进程全已不在时只清锚点、不回报", async () => {
    const root = makeTmp();
    writeSession(root, {
      launcher_pid: 0x7f_ff_ff_fe,
      child_pids: [0x7f_ff_ff_fd, 0x7f_ff_ff_fa],
      app_port: 3311,
      mode: "web",
      started_at: new Date().toISOString(),
    });
    touchHeartbeat(root, Date.now() - HEARTBEAT_STALE_MS - 1000);

    expect(await reapStaleSession(root)).toBeNull();
    expect(readSession(root)).toBeNull();
  });

  // 反向面：真的有活着的子树才回收，并把被回收的 PID 报给调用方（用户可见的
  // WARN 只在这种情况下出现）。
  it("回收上一次的残留：还有活着的子树才真回收并回报", async () => {
    const root = makeTmp();
    const child = spawnInGroup({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: process.cwd(),
    });
    const pid = child.pid;
    expect(pid).toBeGreaterThan(0);
    writeSession(root, {
      launcher_pid: 0x7f_ff_ff_fe,
      child_pids: [pid!],
      app_port: 3311,
      mode: "web",
      started_at: new Date().toISOString(),
    });
    touchHeartbeat(root, Date.now() - HEARTBEAT_STALE_MS - 1000);

    expect(await reapStaleSession(root)).toEqual([pid]);
    expect(readSession(root)).toBeNull();
    expect(
      await waitUntil(() => {
        try {
          process.kill(pid!, 0);
          return false;
        } catch {
          return true;
        }
      }, 8000),
    ).toBe(true);
  }, 20_000);

  it(".next 缓存指纹：配置不变则保留，变了才清；SKIP_CLEAN 强制保留", () => {
    const root = makeTmp();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "a" }));
    const first = syncNextCache(root, { NODE_ENV: undefined });
    expect(first.cleaned).toBe(false); // 首次：写初始指纹，不「清理」
    expect(fs.readFileSync(path.join(root, ".next", "config-fingerprint"), "utf8")).toBe(
      configFingerprint(root).hash,
    );

    // 指纹一致 → 保留缓存（不清）
    expect(syncNextCache(root, { NODE_ENV: undefined }).cleaned).toBe(false);

    // 配置内容变了 → 清缓存（否则会拿旧 route/旧 chunk 跑）
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "b" }));
    expect(syncNextCache(root, { NODE_ENV: undefined }).cleaned).toBe(true);

    // SKIP_CLEAN 明确要求保留
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "c" }));
    expect(syncNextCache(root, { NODE_ENV: undefined, SKIP_CLEAN: "1" }).cleaned).toBe(false);
    // FORCE_CLEAN 明确要求清
    expect(syncNextCache(root, { NODE_ENV: undefined, FORCE_CLEAN: "1" }).reason).toContain(
      "FORCE_CLEAN",
    );
  });

  it("壳侧不再依赖 Windows：Cargo 的 windows crate 在非 Windows 下不参与编译", () => {
    const cargo = fs.readFileSync(path.join(process.cwd(), "src-tauri", "Cargo.toml"), "utf8");
    // 无条件依赖 windows crate = Linux/macOS 上编译整棵 windows 树并失败
    // （实测 `error[E0425]: cannot find type IMarshal in windows_core::imp`）。
    expect(cargo).toMatch(/\[target\.'cfg\(windows\)'\.dependencies\]/);
    const [beforeTarget] = cargo.split("[target.'cfg(windows)'.dependencies]");
    expect(beforeTarget).not.toMatch(/^windows\s*=/m);
  });

  it("壳侧 single_instance 有 POSIX 实现（不再是 Windows 独占模块）", () => {
    const mod = fs.readFileSync(
      path.join(process.cwd(), "src-tauri", "src", "single_instance.rs"),
      "utf8",
    );
    // 两条实现都必须在文件里：只有 Windows 那条时，Linux/macOS 上
    // `mod single_instance` 一编译就找不到 another_instance_running（cfg 剪掉了），
    // 表现为「壳编译失败」而不是「单实例失效」——那是最容易被误判成环境问题的形态。
    expect(mod).toContain("#[cfg(windows)]");
    expect(mod).toContain("#[cfg(not(windows))]");
    expect(mod.match(/pub fn another_instance_running/g)?.length).toBe(2);
    expect(mod.match(/pub fn spawn_focus_waiter/g)?.length).toBe(2);
    // Windows 专属 crate 只能出现在 cfg(windows) 之后（Cargo.toml 已由用例 5 守住）
    const windowsUseIdx = mod.indexOf("use windows::");
    const cfgWindowsIdx = mod.indexOf("#[cfg(windows)]");
    expect(cfgWindowsIdx).toBeGreaterThanOrEqual(0);
    expect(windowsUseIdx).toBeGreaterThan(cfgWindowsIdx);
  });

  it("sidecar 的拉起与回收走官方 shell 插件（跨平台机制由它选）", () => {
    const root = process.cwd();
    const lib = readCode("src-tauri/src/lib.rs");
    const cargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
    // 插件在 Rust 侧提供跨平台 spawn/kill：写死 std::process::Command + taskkill
    // 时 POSIX 分支等于「什么都不做」（sidecar 活过壳退出，继续占端口）
    expect(cargo).toContain("tauri-plugin-shell");
    expect(lib).toContain(".plugin(tauri_plugin_shell::init())");
    expect(lib).toMatch(/CommandChild/);
    expect(lib).not.toMatch(/Command::new\("taskkill"\)/);
    // 不向前端暴露执行能力：caps 里不得出现 shell 的 execute/spawn 权限。
    // 面**从目录派生**（登记那三份只在下面那格当"不许掉出去"的锚点）：原先这里写的是
    // `for (const cap of ["default","remote","splash"])` + `if (!existsSync) continue`，
    // 一份 caps 被改名 ⇒ 那一轮静默少判一份，而"少判"与"三份都干净"读起来逐字相同。
    const capsDir = path.join(root, "src-tauri", "capabilities");
    const capsFiles = fs
      .readdirSync(capsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();
    for (const name of capsFiles) {
      expect(
        fs.readFileSync(path.join(capsDir, name), "utf8"),
        `capabilities/${name}：不许把执行能力透给前端`,
      ).not.toMatch(/shell:(allow-execute|allow-spawn)/);
    }
  });

  it("capabilities 那一族的面非空，且登记的三份都在面里", () => {
    const names = fs
      .readdirSync(path.join(process.cwd(), "src-tauri", "capabilities"))
      .filter((name) => name.endsWith(".json"))
      .sort();
    expect(
      names.length,
      "capabilities 目录里一份 .json 都没有 ⇒ 上面那一组反向断言在判一个空面",
    ).toBeGreaterThan(0);
    for (const name of ["default.json", "remote.json", "splash.json"]) {
      expect(
        names,
        `面里不见了 ${name} —— 「不许把执行能力透给前端」会静默少判这一份（目录派生的面` +
          "只认得到的名字，改名 = 掉出去）",
      ).toContain(name);
    }
  });

  it("壳的项目根判据不再绑在 Windows 专属文件上", () => {
    const lib = readCode("src-tauri/src/lib.rs");
    // 旧判据只认 scripts/dev-launcher.ps1 → Linux/macOS 上 resolve_project_root()
    // 恒返回空串：启动页读不到 launch-status、壳日志落不了盘，表现为「一直转圈」。
    // 现在认的是**编排器的唯一实现**（.ps1 只是它的 Windows 调用入口）——
    // 判据绑在入口形态上，换入口时就会再静默失效一次。
    expect(lib).toContain("fn looks_like_project_root");
    expect(lib).toContain('join("dev-launcher.mjs")');
    expect(lib).not.toMatch(/looks_like_project_root[\s\S]{0,400}dev-launcher\.ps1/);
  });

  it("统一编排：Windows 走同一份 .mjs，.ps1 只剩调用入口", () => {
    const root = process.cwd();
    const ps1 = fs.readFileSync(path.join(root, "scripts", "dev-launcher.ps1"), "utf8");
    // 入口只做「定位 + 转交 + 透传退出码」：不再有 Windows 专属的编排调用
    // （taskkill / Get-CimInstance / Job Object / cmd.exe）。
    expect(ps1).toContain("dev-launcher.mjs");
    // 判据是「不再调用」而不是「不再提及」：注释里说清「以前用过什么、现在为什么
    // 不用」是有价值的，拦掉会让注释被迫撒谎。
    for (const forbidden of [
      /taskkill\s+\//,
      /Get-CimInstance\s+-Filter/,
      /Add-Type\s+-TypeDefinition/,
      /cmd\.exe"?\s*\/c/,
    ]) {
      expect(ps1).not.toMatch(forbidden);
    }
    // 「.ps1 只是入口」有机器可查的体积判据：1324 行的旧实现不该再长回来
    expect(ps1.split("\n").length).toBeLessThan(120);
  });

  it("编排器不再自己摸 process.platform（平台判据收在 launcher-core 与 kill-process-tree）", () => {
    const root = process.cwd();
    const launcher = readCode("scripts/dev-launcher.mjs");
    // 唯一允许出现平台判据的地方是它 import 的两个模块：
    //   · launcher-core/shell.mjs 的 isWindows()（进程组 / 可执行名后缀）
    //   · launch-core/procs.mjs 的 isWindows()（进程与端口探测机制）
    expect(launcher).not.toMatch(/process\.platform === "win32"/);
    for (const rel of ["shell.mjs", "procs.mjs", "orchestrator.mjs", "log.mjs", "worktree.mjs"]) {
      expect(fs.existsSync(path.join(root, "scripts", "launcher-core", rel))).toBe(true);
    }
  });

  it("壳退出时的统一回收走 reap-process.mjs（不在 Rust 里重写平台分支）", () => {
    const lib = readCode("src-tauri/src/lib.rs");
    // kill_sidecar 除了插件的 kill()，还要补一刀统一回收：Node 之下的
    // next-server / turbopack worker 才是真正会残留成孤儿的那几层。
    expect(lib).toMatch(/fn kill_sidecar\(project_root: &str\)/);
    expect(lib).toContain("reap-process.mjs");
    expect(lib).not.toMatch(/Command::new\("taskkill"\)/);
  });

  it("sidecar 命名按平台判据收口（不再是写死的 node.exe）", () => {
    const lib = readCode("src-tauri/src/lib.rs");
    // 写死 "node.exe" 时 Linux 启动找不到 sidecar（资源里叫 node，没有后缀）
    expect(lib).not.toMatch(/join\("node\.exe"\)/);
    expect(lib).toContain("sidecar_binary_name");
    const build = readCode("scripts/build-desktop.mjs");
    expect(build).toContain("sidecarFileName");
  });
});

/**
 * Phase 2-C：`scripts/executor-host.mjs` 作为 launcher 的受管子进程。
 *
 * 真进程级验证在 `tests/executor-host.test.ts`（Phase 2-B 已合入）——那三条断
 * 进程能起来、能收 SIGTERM、日志落对地方。这一族**只测接线**：dev-launcher 侧
 * 的 spawnExecutorHost 必须走同一份 `spawnInGroup`（否则 POSIX 上无进程组、
 * reapAll 只能单杀 leader 留孤儿，正是 AGENTS 硬规则 3 禁止的形态）、必须把
 * child 塞进 `spawned` 数组（否则 launcher 收尾时 host 变孤儿）、必须受
 * `COMFY_EXECUTOR` env 门控且**默认 inline**（Phase 2 是灰度起手，不接管流量）。
 * 另加一条：`standalone-private-inputs.mjs` 的 `RUNTIME_SCRIPTS` 必须含
 * `executor-host.mjs`——桌面包用户改 `.env` 试 host 模式时，脚本得随包带出去。
 */
describe("Phase 2-C：executor-host 接入 launcher", () => {
  /* 编排器已按职责拆进 `launcher-core/`（ISSUE #1811 / R5 超限文件），下面几条
   * 断的是**接线形态**而不是「住在哪个文件」—— 所以把主文件与拆出的几份拼成
   * 一份再断。只读主文件时，搬走的实现会让 `indexOf` 落空、`slice` 拿到空串，
   * 断言就**静默变成空转**（`not.toMatch` 恒真）。 */
  /* 走**现算的编排链路闭包**（`launcherChainSource()` 从入口按顶层静态 import
   * 递归收），不再手抄一份文件清单：抄了就会随下一刀拆文件再漏一处，而漏的表现
   * 正是这条判据要防的形态 —— `indexOf` 落空、`not.toMatch` 对着空串恒真。 */
  const launcherSrc = stripJs(launcherChainSource(), { trailing: true });
  const whitelistSrc = readCode("scripts/standalone-private-inputs.mjs");
  /* 「怎么起宿主」自 ISSUE #1767 起收进这份共用件：编排 6.5 步、scripts/start.mjs
   * 的生产链路都要它，两处各写一份的下场是「某一条忘了起」（host 模式下现场是
   * 任务永远停在队列）。下面几条因此把函数体从 launcher 改到共用件上断。 */
  const spawnKernelSrc = readCode("scripts/launcher-core/executor-host-spawn.mjs");

  /* 前置断言：这个 describe 里几组判据既有反向也有正向，反向那几组的接收者
   * 一旦变空就恒真（`launcherChainSource()` 拼空、或某份分件搬走只留说明）。
   * 这一格把"读到了东西"变成显式结论，而不是默认前提。 */
  it("这一族读的三个接收者都非空（闭包 / 白名单 / 起宿主共用件）", () => {
    expect(launcherSrc.trim(), "编排链路闭包剥完是空文").not.toHaveLength(0);
    expect(whitelistSrc.trim(), "白名单那份剥完是空文").not.toHaveLength(0);
    expect(spawnKernelSrc.trim(), "起宿主的共用件剥完是空文").not.toHaveLength(0);
    // 闭包必须真的"收到比入口多"：原先那格只判到"入口里有一段"，而 `relativeDeps`
    // 一旦不再命中（改行动态 import、或说明符换形态），闭包会静默缩成入口一份，
    // 落在闭包上的反向断言就退化成只判入口 —— 那正是本文件头注点名过的失效方向。
    const entryAlone = fs.readFileSync(
      path.join(process.cwd(), "scripts", "dev-launcher.mjs"),
      "utf8",
    );
    expect(
      launcherSrc.length,
      "闭包不比入口单独一份大 ⇒ launcherChainSource() 的递归没收到内部分件，" +
        "下面那几组判的其实只是 dev-launcher.mjs 自己",
    ).toBeGreaterThan(stripJs(entryAlone, { trailing: true }).length);
    for (const marker of [
      "export function spawnExecutorHost(ctx)",
      "export function maybeSpawnExecutorHost(",
    ]) {
      expect(launcherSrc, `闭包里没有 ${marker} —— 它所在的那份内部分件掉出链路了`).toContain(
        marker,
      );
    }
  });

  it("起宿主的实现在共用件里走 spawnInGroup（平台判据不自己摸 process.platform）", () => {
    const start = spawnKernelSrc.indexOf("export function maybeSpawnExecutorHost(");
    expect(start, "maybeSpawnExecutorHost 未定义").toBeGreaterThan(-1);
    const body = spawnKernelSrc.slice(start);
    expect(body).toContain("spawnInGroup(");
    // 反向：不能出现 `spawn(` 直接调（那是绕过进程组语义的形态）。
    expect(body).not.toMatch(/(?<!spawnInGroup\()spawn\(/);
  });

  it("launcher 的 spawnExecutorHost 是薄包装：把 child push 进 spawned（reapAll 才能覆盖）", () => {
    /* 实现搬到 `launcher-core/downstream.mjs` 后，主文件那一段是**一转发的薄包装**
     * （体里既没有 `maybeSpawnExecutorHost(` 也不该有 push —— 那两件事都在实现里）。
     * 这里从实现那一段取体：本用例守的是「拉起宿主的动作真的把 child 记进
     * spawned」，与转发层无关。 */
    const start = launcherSrc.indexOf("export function spawnExecutorHost(ctx)");
    expect(start, "downstream.mjs 里没找到实现").toBeGreaterThan(-1);
    /* 终点必须先验存在：`indexOf("\n}", start)` 取不到给 -1，`slice(start, -1)` 会给出
     * "从实现起点到倒数第二个字符"—— 那比整个函数宽得多，下面两条 `toContain` 仍然成立，
     * 于是判据从"这个包装器记了 child"漂成"后面某处记了 child"。（**已知判不到的那一形**：
     * 收尾被改成缩进、同时 push 搬到后面的函数里 —— 我拿字符串级模拟试过，
     * "区间里只许有一个顶层 export function"那种廉价边界断言在那一形下不红，
     * 所以不留它当装饰；要覆盖它得做配对花括号或 AST 作用域，见 #2660 的批 4 评论。） */
    const end = launcherSrc.indexOf("\n}", start);
    expect(
      end,
      "从实现起点找不到函数收尾（`\\n}`）—— slice(start, -1) 会把区间放宽到后面整段，" +
        "下面两条 toContain 就在判别的东西",
    ).toBeGreaterThan(start);
    const body = launcherSrc.slice(start, end);
    expect(body).toContain("maybeSpawnExecutorHost(");
    expect(body).toContain("spawned.push(result.child)");
  });

  it("run() 以 COMFY_EXECUTOR 门控、默认 inline 不 spawn（Phase 2 只灰度）", () => {
    // 默认必须是 inline —— 未给值时不能起 host。判据自 4-A4（ADR §14 D5）起收在
    // `launcher-core/executor-mode.mjs`（进程 env → .env 回读 → 归一化），launcher
    // 只用它的返回值；门控形状不变：只认 `host`，未知值 warn 后走 inline 分支。
    expect(launcherSrc).toContain('from "./launcher-core/executor-mode.mjs"');
    /* 判据仍是「解出 mode/unknown 两个值」：实现搬进 `dev-boot.mjs` 后判据由
     * 编排器注入（`ctx.resolveExecutorMode`），所以 RHS 允许 `ctx.` 前缀 ——
     * 断的是这个形状，不是「它写在哪个文件 / 怎么拿到那个函数」。 */
    expect(launcherSrc).toMatch(
      /const \{ mode: executorMode, unknown: unknownExecutor \} =\s*\n?\s*ctx\.resolveExecutorMode\(\)/,
    );
    expect(launcherSrc).toMatch(/executorMode === ["']host["']/);
    expect(launcherSrc).toMatch(/spawnExecutorHost\(\)/);
    expect(launcherSrc).toContain("不识别");
  });

  it("4-A4：host 子进程拿到归一化后的 COMFY_EXECUTOR；.env 回读在共享内核里", () => {
    // 显式回写：`.env` 来源时子进程 process.env 里没有这个 key，不传会造成
    // 「launcher 认为 host 模式、host 起着骨架」的静默错配。ISSUE #1767 起这段
    // 在共用件里（三条链路同一份），归一化后的值仍由它显式写回子进程 env。
    expect(spawnKernelSrc).toContain("[EXECUTOR_ENV_KEY]: plan.mode");
    // 回读 `.env` 这件事只许有一份实现（纯 Node 层），且复用既有的 parseEnvFile。
    const kernel = readCode("scripts/launcher-core/executor-mode.mjs");
    expect(kernel).toContain("parseEnvFile(");
    expect(kernel).toContain('"COMFY_EXECUTOR"');
    // launcher 里不许再留第二份归一化实现（漂移就是这么发生的）
    expect(launcherSrc).not.toContain("export function resolveComfyExecutorMode(");
  });

  it("RUNTIME_SCRIPTS 含 executor-host.mjs（桌面包用户改 .env 才能试 host）", () => {
    // 白名单里必须显式列出来；「新增脚本默认不进产物」这条纪律就是靠这个断言守着。
    expect(whitelistSrc).toMatch(/["']executor-host\.mjs["']/);
  });
});

/**
 * 目录迁移的静默失效面：`scripts/**` 用**运行时字符串**加载 `src/lib` 的 TS 模块
 * （纯 Node 靠类型剥离加载，因此路径必须带 `.ts` 后缀），这种说明符不参与 `tsc` /
 * `eslint` 的静态解析，模块换子域时它不会红，只在执行到那一行时抛
 * ERR_MODULE_NOT_FOUND。实测代价：`kill-process-tree` 从 `src/lib/` 迁到
 * `src/lib/process/` 后，回收进程树这条路径整体失效 —— 编排器在「回收上一次残留」这
 * 一步就崩，于是双击起不来、孤儿进程再没人收（它们占着端口，也把产物目录锁住），
 * 而日志里只有一句与真因无关的模块找不到。
 *
 * 判据取**路径字面量本身**（不看 import 语法，字符串常量中转也照样管）：
 * `scripts/` 下出现的每条相对 `../src/lib/` 的 `.ts` 路径都必须真实存在。
 * 拼字符串的形态（把路径拆成数组再 `join`）搜不到 —— 那种写法已在两处说明符的注释里
 * 明确禁止，代之以常量中转（它是字面量，tsc 也不误报 TS5097）。
 */
describe("scripts 里的 src/lib 路径字面量（模块换子域时不许静默失效）", () => {
  const ROOT = process.cwd();
  /** 相对形态 + `.ts` 后缀：这两点都是在纯 Node 下真的能加载起来的前提。 */
  const SPEC_LITERAL_RE = /["'`](\.\.\/src\/lib\/[^"'`\n]+\.ts)["'`]/g;

  /** 剥掉块注释与整行 `//` 注释：注释里解释「为什么用动态 import」不该被当成说明符。 */
  function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^[ \t]*\/\/.*$/gm, "");
  }

  function scriptFiles(dir: string): Array<string> {
    const out: Array<string> = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...scriptFiles(full));
      } else if (/\.(mjs|cjs|ts)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("都指向真实存在的文件（模块换子域时必须跟着改）", () => {
    const offenders: Array<string> = [];
    let checked = 0;
    for (const abs of scriptFiles(path.join(ROOT, "scripts"))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const source = stripComments(fs.readFileSync(abs, "utf8"));
      for (const match of source.matchAll(SPEC_LITERAL_RE)) {
        const specifier = match[1];
        if (!specifier) {
          continue;
        }
        checked += 1;
        if (!fs.existsSync(path.resolve(path.dirname(abs), specifier))) {
          offenders.push(`${rel} → ${specifier}`);
        }
      }
    }
    // 清单不能静默变空：`dev-launcher.mjs` 与 `reap-process.mjs` 各有一条，它们是
    // 「回收残留进程树」的唯一入口 —— 扫不到就说明这条判据本身失效了。
    expect(checked, "没有扫到任何 src/lib 路径字面量——判据失效").toBeGreaterThanOrEqual(2);
    expect(offenders).toEqual([]);
  });
});

describe("classifyProbe（就绪三态：区分「没起来」与「起来了但路由 404」）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("2xx → ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("ready");
  });

  it("404 → route-404（服务活着、路由没进编译图：陈旧路由表的确切签名）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("route-404");
  });

  it("其它非 2xx（如 500 真故障）→ not-up，绝不误判成路由失效去清缓存", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("not-up");
  });

  it("连接上但库是空的（503 + db=empty）→ schema-not-ready 单独一档", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          status: "error",
          db: "empty",
          hint: "数据库表还没建：执行 pnpm db:push",
        }),
      })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("schema-not-ready");
  });

  it("503 但 db=down（库真起不来）→ not-up：不许把真故障说成「表还没建」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ status: "error", db: "down" }),
      })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("not-up");
  });

  it("503 响应体读不出 JSON → not-up（判不出就不下结论）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      })),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("not-up");
  });

  it("连不上（fetch 抛错）→ not-up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await classifyProbe({ port: 3100 })).toBe("not-up");
  });
});

describe("readDiagnosticsTail（失败诊断的取词通道）", () => {
  const tmpDirs: Array<string> = [];

  function makeTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfyapp-diag-"));
    tmpDirs.push(dir);
    return dir;
  }

  /** 造一份应用服务转录（mtime 可指定，用来验「只认本次运行」）。 */
  function writePanel(dir: string, name: string, text: string, mtimeMs: number) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, "utf8");
    fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
    return file;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("stderr 有内容就用 stderr（最贴近失败的那一路）", () => {
    const dir = makeTmp();
    const stderrFile = path.join(dir, "nextjs-stderr.log");
    const stdoutFile = path.join(dir, "nextjs-stdout.log");
    fs.writeFileSync(stderrFile, "stderr 现场\n", "utf8");
    fs.writeFileSync(stdoutFile, "stdout 现场\n", "utf8");
    const tail = readDiagnosticsTail({
      stderrFile,
      stdoutFile,
      panelDir: makeTmp(),
    });
    expect(tail).toContain("stderr 现场");
  });

  it("stderr 为空时退到 stdout —— Next 的横幅与请求日志都在 stdout", () => {
    const dir = makeTmp();
    const stderrFile = path.join(dir, "nextjs-stderr.log");
    const stdoutFile = path.join(dir, "nextjs-stdout.log");
    fs.writeFileSync(stderrFile, "", "utf8");
    fs.writeFileSync(stdoutFile, "GET /api/health 503\n", "utf8");
    expect(readDiagnosticsTail({ stderrFile, stdoutFile, panelDir: makeTmp() })).toContain("503");
  });

  it("两个重定向文件都空 → 退到应用服务转录（同步 append，随写随见）", () => {
    const dir = makeTmp();
    const panelDir = makeTmp();
    const stderrFile = path.join(dir, "nextjs-stderr.log");
    const stdoutFile = path.join(dir, "nextjs-stdout.log");
    fs.writeFileSync(stderrFile, "", "utf8");
    fs.writeFileSync(stdoutFile, "", "utf8");
    writePanel(
      panelDir,
      "nextjs-panel-100-1.log",
      "----- 应用服务输出（本次运行）-----\nhealth_check_schema_not_ready\n",
      Date.now(),
    );
    const tail = readDiagnosticsTail({ stderrFile, stdoutFile, panelDir });
    expect(tail).toContain("health_check_schema_not_ready");
  });

  it("三路都空 → 空串（调用方给兜底文案，不在这里编）", () => {
    const dir = makeTmp();
    expect(
      readDiagnosticsTail({
        stderrFile: path.join(dir, "none-stderr.log"),
        stdoutFile: path.join(dir, "none-stdout.log"),
        panelDir: path.join(dir, "none-panel"),
      }),
    ).toBe("");
  });

  it("best-effort：没有 panelDir 时不当成错误（转录目录可能还不存在）", () => {
    const dir = makeTmp();
    const stdoutFile = path.join(dir, "nextjs-stdout.log");
    fs.writeFileSync(stdoutFile, "只有 stdout\n", "utf8");
    expect(readDiagnosticsTail({ stdoutFile, panelDir: null })).toContain("只有 stdout");
  });

  it("panelSince 之前的转录一律不算 —— 不把上一次的失败现场摆给用户", () => {
    const panelDir = makeTmp();
    const now = Date.now();
    writePanel(panelDir, "nextjs-panel-1-1.log", "上一次的失败\n", now - 60_000);
    writePanel(panelDir, "nextjs-panel-2-2.log", "本次的失败\n", now);
    expect(readDiagnosticsTail({ panelDir, panelSince: now - 5000 })).toContain("本次的失败");
    expect(readDiagnosticsTail({ panelDir, panelSince: now + 60_000 })).toBe("");
  });

  it("latestPanelTranscript：取 mtime 最新的那一份；目录不在时返回 null", () => {
    const panelDir = makeTmp();
    const now = Date.now();
    writePanel(panelDir, "nextjs-panel-1-1.log", "旧\n", now - 60_000);
    writePanel(panelDir, "nextjs-panel-2-2.log", "新\n", now);
    fs.writeFileSync(path.join(panelDir, "nextjs-stdout-1.log"), "不是转录", "utf8");
    expect(latestPanelTranscript(panelDir)).toContain("nextjs-panel-2-2.log");
    expect(latestPanelTranscript(path.join(panelDir, "不存在"))).toBeNull();
  });
});
