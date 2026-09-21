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
 * **第二轮（本条 ISSUE 的后续）：Python 启动器整体移除**，双击 `app.exe` 是唯一
 * 的启动入口形态。随之搬进壳的三件事也在这里钉住：运行模式由壳自己定（按编排器
 * 在不在）、双击单实例的「唤起已有实例」仍由壳自己承担、失败时写启动页可见的出口。
 *
 * 本用例钉死五条契约（每条都做了反向验证：还原旧实现，对应用例必失败）：
 *   1. **认亲判据是环境标记，不是形态**。环境块里的 `COMFYAPP_SHELL_OWNED`
 *      只有壳自己写、只有它起的编排器才有；把它换成「命令行里有没有项目根」
 *      或「有没有 dev server 在跑」，回收就会打到**别人的**启动过程上 ——
 *      误认一次就是误杀一次。
 *   2. **不许同时起两份编排**：壳起之前先清掉上一次运行遗留的编排器（原先靠
 *      「有就跳过」，现在双击路径上不存在「别人起的编排器」，只能回收旧孤儿）。
 *   3. **回收链不许断**：壳退出 → 回收自己起的编排器（插件 kill + 统一回收），
 *      并且**转发给 `scripts/reap-process.mjs`**，而不是在 Rust 里另写一套
 *      `taskkill`（POSIX 上会退化成单杀 leader，AGENTS 硬规则 3）。
 *   4. **运行模式由壳决定**（按编排器在不在），且只在 release 写 —— debug 归
 *      `pnpm tauri dev` 管，壳再插一手就是两边争同一个端口。
 *   5. **起不来有人类可见出口**：写 `run/launch-status.json`，启动页据此显示原因
 *      （原先这个出口是 Python 启动器的 msgbox，随它一起消失）。
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

  it("标记由壳写进编排器环境，常量只定义一次", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toContain('.env(OWNED_ENV, "1")');
    // 常量只许有一处定义 + 一处使用（写进编排器环境）——两边各写一个字面量
    // 就又是一处会静默漂移的判据（一边改成 SHELL_OWNED=yes，另一边永远认不出）。
    expect(rust.match(/"COMFYAPP_SHELL_OWNED"/g)?.length).toBe(1);
  });

  it("Python 启动器已整体移除（唯一入口是 app.exe）", () => {
    expect(
      fs.existsSync(path.join(ROOT, "scripts", "start_tauri_launcher.py")),
    ).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "tools", "start-tauri.spec"))).toBe(
      false,
    );
    for (const rel of [
      "tools/build/build-launcher.ps1",
      "tools/build/build-launcher-dev.ps1",
      "tools/build/build-launcher-standalone.ps1",
      "tools/scripts/build-launcher.ps1",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} 应已删除`).toBe(
        false,
      );
    }
    // 唯一的双击入口（.ps1 壳层）指向那个 exe 本身，不再指向第二层启动器。
    const entry = read("tools/start/start-tauri.ps1");
    expect(entry).toContain("src-tauri");
    expect(entry).toContain("app.exe");
  });
});

describe("壳自编排：两个入口不许同时起两份编排", () => {
  it("起第二份之前先回收上一次遗留的编排器（不再有「命中就跳过」的捷径）", () => {
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    // 编排步骤体在命名函数里（Rust 侧函数长度阈值 120 行，见规范 §12.13），
    // 调用点必须仍是安装期的一条：`if self_launch { … }`。
    expect(lib).toMatch(
      /if self_launch \{\s*start_self_orchestration\(app, &project_root\);/,
    );
    const branch = lib.slice(
      lib.indexOf("fn start_self_orchestration("),
      lib.indexOf("fn start_own_orchestrator("),
    );
    // 判据是环境块标记（不是「有没有 dev server」），命中即回收：
    // 「别人已经在编排」这条路在双击形态下不存在（编排器只可能是壳自己起的），
    // 残留只可能是壳被强杀留下的孤儿 —— 留着它会占着端口，表现为双击没反应。
    expect(branch).toContain("shell_launch::find_owned_orchestrator()");
    expect(branch).toContain("shell_launch::reap_pid(project_root, pid)");
    expect(branch).toContain(
      "start_own_orchestrator(app.handle(), project_root)",
    );
    // 命中残留要说清「先回收再启动」，别让它看起来像一次正常启动。
    expect(branch).toContain("先回收它再启动本次编排");
  });

  it("自编排只在 release、且在没人替壳做过编排决策时生效（debug 归 pnpm tauri dev 管）", () => {
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    const decl = lib.slice(
      lib.indexOf("let self_launch ="),
      lib.indexOf("let self_launch =") + 400,
    );
    expect(decl).toContain("cfg!(not(debug_assertions))");
    // 判据是 COMFYAPP_PROJECT_ROOT 缺席（= 没人给壳指路，是用户双击了 exe 本身）。
    // 用它而不是 COMFYAPP_LAUNCH_MODE：后者现在由壳自己写，判据会随写入顺序漂。
    expect(decl).toContain('std::env::var("COMFYAPP_PROJECT_ROOT").is_err()');
    expect(decl).toContain("!project_root.is_empty()");
  });

  it("运行模式由壳自己按「编排器在不在」决定，且只在 release 写", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(/pub fn ensure_launch_mode\(project_root: &str\)/);
    expect(rust).toContain("orchestrator_script(project_root).is_some()");
    expect(rust).toContain("COMFYAPP_LAUNCH_MODE");
    expect(rust).toMatch(
      /#\[cfg\(not\(debug_assertions\)\)\]\s*pub fn ensure_launch_mode/,
    );
    expect(rust).toMatch(
      /#\[cfg\(debug_assertions\)\]\s*pub fn ensure_launch_mode\(_project_root: &str\) \{\}/,
    );
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    expect(lib).toContain("shell_launch::ensure_launch_mode(project_root)");
  });

  it("起不来写启动页可见的出口（原先由 Python 启动器的弹窗承担）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(
      /pub fn mark_launch_failed\(project_root: &str, message: &str\)/,
    );
    expect(rust).toContain("launch-status.json");
    expect(rust).toContain('"phase": "error"');
    // progress 必须是 0：启动页把 100% 画成「✓」，一次失败会看起来像「成功但没打开」。
    expect(rust).toMatch(/"progress": 0,/);
    // 写失败只记 WARN：失败出口本身不该再产生一个失败。
    expect(rust).toContain("create_dir_all");
    const lib = stripComments(read("src-tauri/src/lib.rs"));
    expect(lib).toMatch(
      /shell_launch::mark_launch_failed\([\s\S]{0,200}pnpm install/,
    );
  });
});

describe("壳自编排：启动期的可见性（ISSUE #784 手验反馈）", () => {
  const splash = () => read("src-tauri/splash-assets/index.html");

  it("壳的常驻快照不许让进度条倒退（0% 是「还没有权威进度」，不是「回到起点」）", () => {
    const page = splash();
    // 快照轮必须被标记出来，updateUI 才会拿 maxProgress 兜底。
    expect(page).toContain("updateFromShellFallback");
    expect(page).toMatch(
      /updateFromShellFallback && !error\) raw = Math\.max\(raw, maxProgress\)/,
    );
    // 标记必须**每轮都重算**：编排器写自己的状态之后就再也不该走这条兜底
    //（否则它的 20% 也会被抬到上一次的 30%）。
    const marks = page.match(/updateFromShellFallback =/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(3);
  });

  it("启动失败必须在启动页上看得见（状态里 error / shellLaunchFailed 都要认）", () => {
    const page = splash();
    // 壳识别出自编排走不通时写的标记：明细只在那份状态里，不带出来用户只能干等。
    expect(page).toContain("shellLaunchFailed");
    expect(page).toContain("failureDiagnostics");
    // 「再等等」不是失败态的出路：面板要自己打开。
    expect(page).toMatch(/status\.error \|\| status\.shellLaunchFailed/);
    // 有失败态时面板给的是失败诊断（含壳写下的路径），而不是「日志还没写入」。
    expect(page).toMatch(/failureDiagnostics\(status\)/);
  });

  it("快照自己也带诊断出口（编排器顶掉它之前，现场已经在磁盘上）", () => {
    const page = splash();
    // 编排器写的 launch-status.json 不带 diagnostics，一写就把壳的快照整份顶掉；
    // 空面板这段窗口期只能靠快照里那几条路径（页面不自己拼路径）。
    expect(page).toContain("diag.launchLog");
    expect(page).toContain("diag.statusFile");
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    expect(rust).toMatch(/pub fn write_idle_status\(/);
    expect(rust).toContain('"diagnostics"');
    expect(rust).toContain("startup_report_json");
  });

  it("读不到日志时把壳写下的启动报告一并给出（报告是那一刻唯一的现场）", () => {
    const rust = stripComments(read("src-tauri/src/lib.rs"));
    // 三个路径全空 → 只回「暂无日志」等于让用户去贴截图；报告里有项目根、
    // 编排脚本是否找到、端口与各日志路径，用户贴这一屏就等于把现场带出来。
    expect(rust).toContain("startup_report_section");
    expect(rust).toMatch(/report[\s\S]{0,200}no_log_guidance\(&root\)/);
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

  it("按 PID 回收上一次的残留也走同一处平台判据", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    const fn = rust.slice(
      rust.indexOf("pub fn reap_pid("),
      rust.indexOf("pub fn ensure_launch_mode("),
    );
    // 不许在壳里另写一套 taskkill / 单杀 leader（硬规则 3）：转交统一回收。
    expect(fn).toContain("spawn_reaper(");
    expect(fn).not.toMatch(/taskkill|Command::new\("kill"\)/);
    // 自残保护：不回收自己（壳自己也在进程表里）。
    expect(fn).toContain("std::process::id()");
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

  it("编排脚本路径拼接只有一处（启动器已移除，壳是唯一持有者）", () => {
    const rust = stripComments(read("src-tauri/src/shell_launch.rs"));
    const occurrences = rust.match(/join\("scripts"\)/g) ?? [];
    // shell_launch.rs 里出现三处 join("scripts")：orchestrator_script（脚本位置）、
    // spawn_reaper（统一回收入口）、can_self_launch 的存在性检查 —— 都是「按项目根
    // 拼一个脚本路径」的同一件事，改动时几处一起改。数量钉住是为了让「又多抄一份
    // 路径拼接」这件事在评审里显形（而不是悄悄多一处会漂的副本）。
    // （Job Object 已改回壳内联实现，不再有 win_job.py 那条脚本路径。）
    expect(occurrences.length).toBe(3);
  });
});
