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

/** 数出「进程组」里还剩几个活着的标记进程（用唯一标记匹配命令行）。 */
function countMarkedProcesses(marker: string): number {
  const out = execFileSync("ps", ["-eo", "pid,args"], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((line: string) => line.includes(marker) && !line.includes("ps -eo"))
    .length;
}

async function waitUntil(
  check: () => boolean,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe("跨平台启动编排（dev-launcher.mjs）", () => {
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfyapp-launcher-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
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
        args: [
          "-c",
          `sh -c 'sleep 60 # ${marker}' & sh -c 'sleep 60 # ${marker}' & wait`,
        ],
        cwd: process.cwd(),
      });
      expect(
        await waitUntil(() => countMarkedProcesses(marker) >= 3, 8000),
      ).toBe(true);

      const result = await killProcessTree({ pid: child.pid!, detached: true });
      expect(result.ok).toBe(true);
      // 「整组」是判据：信号落到 -pgid，而不只是 leader。
      expect(result.via).toContain("进程组");

      expect(
        await waitUntil(() => countMarkedProcesses(marker) === 0, 8000),
      ).toBe(true);
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
      child_pids: [] as number[],
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
    writeSession(root, { ...session, launcher_pid: 0x7ffffffe });
    expect(isSessionOwnerAlive(root)).toBe(false);

    clearSession(root);
    expect(readSession(root)).toBeNull();
  });

  it(".next 缓存指纹：配置不变则保留，变了才清；SKIP_CLEAN 强制保留", () => {
    const root = makeTmp();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "a" }),
    );
    const first = syncNextCache(root, { NODE_ENV: undefined });
    expect(first.cleaned).toBe(false); // 首次：写初始指纹，不「清理」
    expect(
      fs.readFileSync(path.join(root, ".next", "config-fingerprint"), "utf8"),
    ).toBe(configFingerprint(root).hash);

    // 指纹一致 → 保留缓存（不清）
    expect(syncNextCache(root, { NODE_ENV: undefined }).cleaned).toBe(false);

    // 配置内容变了 → 清缓存（否则会拿旧 route/旧 chunk 跑）
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "b" }),
    );
    expect(syncNextCache(root, { NODE_ENV: undefined }).cleaned).toBe(true);

    // SKIP_CLEAN 明确要求保留
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "c" }),
    );
    expect(
      syncNextCache(root, { NODE_ENV: undefined, SKIP_CLEAN: "1" }).cleaned,
    ).toBe(false);
    // FORCE_CLEAN 明确要求清
    expect(
      syncNextCache(root, { NODE_ENV: undefined, FORCE_CLEAN: "1" }).reason,
    ).toContain("FORCE_CLEAN");
  });

  it("壳侧不再依赖 Windows：Cargo 的 windows crate 在非 Windows 下不参与编译", () => {
    const cargo = fs.readFileSync(
      path.join(process.cwd(), "src-tauri", "Cargo.toml"),
      "utf8",
    );
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
    const lib = fs.readFileSync(
      path.join(root, "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    const cargo = fs.readFileSync(
      path.join(root, "src-tauri", "Cargo.toml"),
      "utf8",
    );
    // 插件在 Rust 侧提供跨平台 spawn/kill：写死 std::process::Command + taskkill
    // 时 POSIX 分支等于「什么都不做」（sidecar 活过壳退出，继续占端口）
    expect(cargo).toContain("tauri-plugin-shell");
    expect(lib).toContain(".plugin(tauri_plugin_shell::init())");
    expect(lib).toMatch(/CommandChild/);
    expect(lib).not.toMatch(/Command::new\("taskkill"\)/);
    // 不向前端暴露执行能力：caps 里不得出现 shell 的 execute/spawn 权限
    for (const cap of ["default", "remote", "splash"]) {
      const file = path.join(root, "src-tauri", "capabilities", `${cap}.json`);
      if (!fs.existsSync(file)) continue;
      expect(fs.readFileSync(file, "utf8")).not.toMatch(
        /shell:(allow-execute|allow-spawn)/,
      );
    }
  });

  it("壳的项目根判据不再绑在 Windows 专属文件上", () => {
    const lib = fs.readFileSync(
      path.join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // 旧判据只认 scripts/dev-launcher.ps1 → Linux/macOS 上 resolve_project_root()
    // 恒返回空串：启动页读不到 launch-status、壳日志落不了盘，表现为「一直转圈」。
    // 现在认的是**编排器的唯一实现**（.ps1 只是它的 Windows 调用入口）——
    // 判据绑在入口形态上，换入口时就会再静默失效一次。
    expect(lib).toContain("fn looks_like_project_root");
    expect(lib).toContain('join("dev-launcher.mjs")');
    expect(lib).not.toMatch(
      /looks_like_project_root[\s\S]{0,400}dev-launcher\.ps1/,
    );
  });

  it("统一编排：Windows 走同一份 .mjs，.ps1 只剩调用入口", () => {
    const root = process.cwd();
    const ps1 = fs.readFileSync(
      path.join(root, "scripts", "dev-launcher.ps1"),
      "utf8",
    );
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
    const launcher = fs.readFileSync(
      path.join(process.cwd(), "scripts", "dev-launcher.mjs"),
      "utf8",
    );
    // 唯一允许出现平台判据的地方是它 import 的两个模块：
    //   · launcher-core/shell.mjs 的 isWindows()（进程组 / 可执行名后缀）
    //   · launch-core/procs.mjs 的 isWindows()（进程与端口探测机制）
    expect(launcher).not.toMatch(/process\.platform === "win32"/);
    for (const rel of [
      "shell.mjs",
      "procs.mjs",
      "orchestrator.mjs",
      "log.mjs",
      "worktree.mjs",
    ]) {
      expect(
        fs.existsSync(path.join(root, "scripts", "launcher-core", rel)),
      ).toBe(true);
    }
  });

  it("壳退出时的统一回收走 reap-process.mjs（不在 Rust 里重写平台分支）", () => {
    const root = process.cwd();
    const lib = fs.readFileSync(
      path.join(root, "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // kill_sidecar 除了插件的 kill()，还要补一刀统一回收：Node 之下的
    // next-server / turbopack worker 才是真正会残留成孤儿的那几层。
    expect(lib).toMatch(/fn kill_sidecar\(project_root: &str\)/);
    expect(lib).toContain("reap-process.mjs");
    expect(lib).not.toMatch(/Command::new\("taskkill"\)/);
  });

  it("sidecar 命名按平台判据收口（不再是写死的 node.exe）", () => {
    const lib = fs.readFileSync(
      path.join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    // 写死 "node.exe" 时 Linux 启动找不到 sidecar（资源里叫 node，没有后缀）
    expect(lib).not.toMatch(/join\("node\.exe"\)/);
    expect(lib).toContain("sidecar_binary_name");
    const build = fs.readFileSync(
      path.join(process.cwd(), "scripts", "build-desktop.mjs"),
      "utf8",
    );
    expect(build).toContain("sidecarFileName");
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
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
  }

  function scriptFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...scriptFiles(full));
      else if (/\.(mjs|cjs|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("都指向真实存在的文件（模块换子域时必须跟着改）", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const abs of scriptFiles(path.join(ROOT, "scripts"))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const source = stripComments(fs.readFileSync(abs, "utf8"));
      for (const match of source.matchAll(SPEC_LITERAL_RE)) {
        const specifier = match[1];
        if (!specifier) continue;
        checked += 1;
        if (!fs.existsSync(path.resolve(path.dirname(abs), specifier))) {
          offenders.push(`${rel} → ${specifier}`);
        }
      }
    }
    // 清单不能静默变空：`dev-launcher.mjs` 与 `reap-process.mjs` 各有一条，它们是
    // 「回收残留进程树」的唯一入口 —— 扫不到就说明这条判据本身失效了。
    expect(
      checked,
      "没有扫到任何 src/lib 路径字面量——判据失效",
    ).toBeGreaterThanOrEqual(2);
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
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfyapp-diag-"));
    tmpDirs.push(dir);
    return dir;
  }

  /** 造一份应用服务转录（mtime 可指定，用来验「只认本次运行」）。 */
  function writePanel(
    dir: string,
    name: string,
    text: string,
    mtimeMs: number,
  ) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text, "utf8");
    fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
    return file;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
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
    expect(
      readDiagnosticsTail({ stderrFile, stdoutFile, panelDir: makeTmp() }),
    ).toContain("503");
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
    expect(readDiagnosticsTail({ stdoutFile, panelDir: null })).toContain(
      "只有 stdout",
    );
  });

  it("panelSince 之前的转录一律不算 —— 不把上一次的失败现场摆给用户", () => {
    const panelDir = makeTmp();
    const now = Date.now();
    writePanel(
      panelDir,
      "nextjs-panel-1-1.log",
      "上一次的失败\n",
      now - 60_000,
    );
    writePanel(panelDir, "nextjs-panel-2-2.log", "本次的失败\n", now);
    expect(
      readDiagnosticsTail({ panelDir, panelSince: now - 5_000 }),
    ).toContain("本次的失败");
    expect(readDiagnosticsTail({ panelDir, panelSince: now + 60_000 })).toBe(
      "",
    );
  });

  it("latestPanelTranscript：取 mtime 最新的那一份；目录不在时返回 null", () => {
    const panelDir = makeTmp();
    const now = Date.now();
    writePanel(panelDir, "nextjs-panel-1-1.log", "旧\n", now - 60_000);
    writePanel(panelDir, "nextjs-panel-2-2.log", "新\n", now);
    fs.writeFileSync(
      path.join(panelDir, "nextjs-stdout-1.log"),
      "不是转录",
      "utf8",
    );
    expect(latestPanelTranscript(panelDir)).toContain("nextjs-panel-2-2.log");
    expect(latestPanelTranscript(path.join(panelDir, "不存在"))).toBeNull();
  });
});
