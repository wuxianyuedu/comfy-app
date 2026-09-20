/**
 * 回归护栏：**壳自编排**（ISSUE #784，「只启动一个 exe」）。
 *
 * 现场（用户原话）：「主要是想只启动一个 exe。双击 app.exe → MSHTML 画面 +
 * WebView2 env A → 启动编排拉起第二个 app.exe 这种也不是想要的方式」。
 *
 * 旧链路是「双击 start-tauri.exe（python 启动器）→ 它起 dev-launcher.mjs →
 * 编排器再起 app.exe」，也就是说**双击的是启动器、跑起来两个进程、任务栏上
 * 两个图标**，而且用户关掉主窗后整棵树能不能被回收，取决于启动器退出前有没有
 * 把 Job Object 句柄交出去。
 *
 * 本用例钉死四条契约（每条都做了反向验证：还原旧实现，对应用例必失败）：
 *   1. **认亲判据是环境标记，不是形态**。环境块里的 `COMFYAPP_SHELL_OWNED`
 *      只有壳自己写、只有它起的编排器才有；把判据换成「命令行里有没有项目根」
 *      或「有没有 dev server 在跑」时，启动器会让位给**别人的**编排器、壳会去
 *      杀**用户的**启动过程 —— 误认一次就是误杀一次。
 *   2. **两个入口不许同时起两份编排**：壳起之前先查有没有自己认领过的编排器
 *      在跑；python 启动器起之前先查有没有壳起的编排器在跑。
 *   3. **回收链不许断**：壳退出 → 回收自己起的编排器（插件 kill + 统一回收），
 *      并且**转发给 `scripts/reap-process.mjs`**，而不是在 Rust 里另写一套
 *      `taskkill`（POSIX 上会退化成单杀 leader，AGENTS 硬规则 3）。
 *   4. **壳的退出路径只给「自己起的」编排器补刀**，启动器的兜底补刀遇到
 *      壳自编排的编排器要让开（它随壳退出，杀了就是把用户正在用的应用掐掉）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** 剥掉注释：注释里解释「为什么不是那种写法」不该被判据当成实现。 */
function stripComments(source: string, lineComments = true): string {
  const noBlock = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*<!--[\s\S]*?-->/gm, "");
  return lineComments ? noBlock.replace(/^[ \t]*\/\/.*$/gm, "") : noBlock;
}

describe("壳自编排：认亲判据", () => {
  it("壳侧认亲只看 COMFYAPP_SHELL_OWNED（不看「有没有 dev server」这类形态）", () => {
    const source = stripComments(read("src-tauri/src/shell_launch.rs"));
    // 判据本体：环境里必须恰好等于 "1"。
    expect(source).toContain("COMFYAPP_SHELL_OWNED");
    expect(source).toMatch(
      /pub const OWNED_ENV: &str = "COMFYAPP_SHELL_OWNED"/,
    );
    expect(source).toMatch(/pub fn is_own\(/);
    // 认亲**不能**退化成按名字 / 路径 / 端口猜：那三条都只能说明「有个编排在跑」，
    // 认不出是谁起的，而这里紧跟着的动作是「复用它」或「回收它」。
    const findFn = source.slice(
      source.indexOf("pub fn find_owned_orchestrator"),
    );
    expect(findFn).toContain("process_env_is_owned");
    expect(findFn).not.toMatch(/CommandLine|tasklist|wmic/i);
  });

  it("标记由壳写进编排器环境（两边同名，改一处必须两处都改）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    const py = stripComments(read("scripts/start_tauri_launcher.py"), false);
    expect(rust).toContain('.env(OWNED_ENV, "1")');
    // Python 侧的判断常量必须与 Rust 侧同名：两边各写一个字面量就又是一处
    // 会静默漂移的判据（一边改成 SHELL_OWNED=yes，另一边就永远认不出）。
    expect(py).toContain('_SHELL_OWNED_ENV = "COMFYAPP_SHELL_OWNED"');
    expect(py).toContain('f"{_SHELL_OWNED_ENV}=1"');
  });
});

describe("壳自编排：两个入口不许同时起两份编排", () => {
  it("壳在 setup 里先查「有没有自己认领过的编排器还活着」", () => {
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    expect(lib).toContain("mod shell_launch");
    expect(lib).toContain("start_own_orchestrator");
    const branch = lib.slice(lib.indexOf("if self_launch {"));
    expect(branch).toContain("shell_launch::find_owned_orchestrator()");
    // 找到就先记日志、不起第二份 —— 第二份编排会争同一个端口，也会把对方的
    // dev server 当成「上一次的孤儿」回收掉。
    expect(branch).toContain("will not start a second one");
  });

  it("python 启动器发现壳已编排时让位（而不是再起一份）", () => {
    const py = stripComments(read("scripts/start_tauri_launcher.py"), false);
    const launcherFn = py.slice(py.indexOf("def launch_dev_server("));
    expect(launcherFn).toContain("_find_shell_owned_orchestrator()");
    expect(launcherFn).toContain(
      "reusing it instead of starting a second orchestrator",
    );
    // 「让位」与「真的起不来」共用 None 返回值，必须有显式标记分开：把让位报成
    // 失败会弹一个红色「无法启动 dev-launcher.mjs」，而现场一切正常。
    expect(py).toContain("def shell_launch_handoff()");
    expect(py).toMatch(/if proc is None and not shell_launch_handoff\(\)/);
  });

  it("自编排只在 release、且没人注入启动模式时生效（debug 归 pnpm tauri dev 管）", () => {
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    const decl = lib.slice(
      lib.indexOf("let self_launch ="),
      lib.indexOf("let self_launch =") + 400,
    );
    expect(decl).toContain("cfg!(not(debug_assertions))");
    expect(decl).toContain("launch_mode.is_empty()");
    expect(decl).toContain("!project_root.is_empty()");
  });
});

describe("壳自编排：回收链", () => {
  it("壳退出时回收自己起的编排器整棵树（转发给 reap-process.mjs）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(/pub fn reap\(project_root: &str\)/);
    // 两道机制：插件的 kill()（跨平台）+ 统一回收（不漏 node 下面那几层）。
    expect(rust).toContain("child.kill()");
    expect(rust).toContain("reap-process.mjs");
    // **不许在 Rust 里重写平台分支**：POSIX 上 taskkill 等于什么都不做，
    // 而单杀 leader 会留下 pnpm / next / turbopack worker（硬规则 3）。
    expect(rust).not.toMatch(/Command::new\("taskkill"\)/);
    expect(rust).not.toMatch(/taskkill \/PID/);
  });

  it("壳退出路径只给「自己起的」编排器补刀", () => {
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    const onExit = lib.slice(lib.indexOf("tauri::RunEvent::Exit =>"));
    expect(onExit).toContain("shell_launch::is_owning()");
    expect(onExit).toContain("shell_launch::reap(&root)");
  });

  it("启动器的兜底补刀放过壳自编排的编排器（它随壳退出）", () => {
    const py = stripComments(read("scripts/start_tauri_launcher.py"), false);
    const killFn = py.slice(py.indexOf("def _kill_shell_from_pid_file("));
    expect(killFn).toContain("_is_shell_owned_pid(pid)");
    expect(killFn).toContain("it dies with that shell");
  });

  it("reap-process.mjs 支持 --detach（正在退出的宿主等不起 wait）", () => {
    const source = stripComments(read("scripts/reap-process.mjs"));
    expect(source).toContain('"--detach"');
    expect(source).toContain("wait: !detach");
    // 与壳侧的调用形态必须一致：壳只传 --force --detach，不再自己拼命令。
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(/arg\("--detach"\)/);
  });

  it("壳自编排时给编排器挂 KILL_ON_JOB_CLOSE job（崩溃/硬杀也不留孤儿）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toContain("attach_kill_on_close_job");
    expect(rust).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    // 非 Windows 上必须有空实现，否则调用点要按平台分叉（判据只收一处，§9.2）。
    expect(rust).toMatch(
      /#\[cfg\(not\(windows\)\)\]\s*pub fn attach_kill_on_close_job\(\) \{\}/,
    );
    // Cargo feature 也必须真的开：漏了它整个 crate 编译不过（且报错与业务无关）。
    const cargo = read("src-tauri/Cargo.toml");
    for (const feature of [
      "Win32_System_JobObjects",
      "Win32_System_Diagnostics_ToolHelp",
      "Win32_System_Diagnostics_Debug",
    ]) {
      expect(cargo).toContain(feature);
    }
  });
});

describe("壳自编排：能自起的判据与真起得来", () => {
  it("can_self_launch 只读、且宁可漏判成「不能」", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    const fn = rust.slice(
      rust.indexOf("pub fn can_self_launch("),
      rust.indexOf("pub fn decide_front_when_self_launched("),
    );
    // 判据是「编排脚本 + .modules.yaml + 关键依赖」三件**存在性**检查
    //（跑在 CreateProcess 前置检查里，不能去起进程 / 不能耗时）：脚本路径经
    // orchestrator_script()（唯一出处）拿，不在这里再拼一份。
    expect(fn).toContain("orchestrator_script(project_root)");
    expect(fn).toContain(".modules.yaml");
    expect(fn).toContain('"typescript"');
    expect(fn).toContain('"next"');
    expect(fn).not.toMatch(/spawn|output\(\)|Command::new/);
  });

  it("壳按「谁起的这段编排」给前台，不再靠第二个进程复核", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(/pub fn decide_front_when_self_launched\(\) -> bool/);
    // 启动器已注入时以它为准（--background / --foreground 的语义不能被默认值吃掉）。
    expect(rust).toMatch(/pub fn read_foreground_env\(\) -> Option<bool>/);
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    expect(lib).toContain("shell_launch::read_foreground_env()");
    expect(lib).toContain("shell_launch::decide_front_when_self_launched");
  });

  it("启动脚本真能起：`node scripts/dev-launcher.mjs --mode prebuilt` 是干跑合法的", () => {
    // 干跑是编排器自带的形态（COMFYAPP_LAUNCHER_DRY_RUN=1，见 dev-launcher.mjs 尾部）：
    // 它证明「壳拼出来的那条命令行」真的能被 node 接住，而不是只证明源码里有那几个字。
    const out = execFileSync(
      process.execPath,
      [path.join("scripts", "dev-launcher.mjs"), "--mode", "prebuilt"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, COMFYAPP_LAUNCHER_DRY_RUN: "1" },
      },
    );
    expect(out).toContain("dry-run");
  });

  it("编排脚本路径拼接只有一处（壳与启动器不许各拼一份）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    const occurrences = rust.match(/join\("scripts"\)/g) ?? [];
    // shell_launch.rs 里出现三处 join("scripts")：orchestrator_script（脚本位置）、
    // spawn_reaper（统一回收入口）、can_self_launch 的存在性检查 —— 都是「按项目根
    // 拼一个脚本路径」的同一件事，改动时几处一起改。数量钉住是为了让「又多抄一份
    // 路径拼接」这件事在评审里显形（而不是悄悄多一处会漂的副本）。
    expect(occurrences.length).toBe(3);
    const py = stripComments(read("scripts/start_tauri_launcher.py"), false);
    expect(py).toContain('"dev-launcher.mjs"');
  });
});
