// 壳侧启动链路的「可观测性」：谁起的编排器、日志写到哪、启动页在启动窗口期里
// 应该读什么（ISSUE #784 手验反馈：「启动读不到日志，启动状态文件也没有」）。
//
// ## 为什么需要这个模块
//
// ISSUE #784 让壳自己承担编排（双击 app.exe 即完整启动）。但**可见性那一层
// 还留在旧链路里**：壳只把编排器的输出转发进 log:: 通道，而 release 构建
// （Windows windows_subsystem = "windows"，无控制台）下 stdout/stderr 没有
// 任何去处 —— 于是「自己编排」这条**唯一的启动路径**，在启动期是**一片空白**：
//
//   1. run/launch-status.json 由 dev-launcher.mjs 写，而它在壳起编排器
//      **之后**才存在，中间是 1~2 秒的空档；
//   2. 编排器起不来时，壳只写一份 phase=error 的**失败**状态 ——「还在启动」
//      这一段没有任何快照；
//   3. 此时 get_launch_log 看的三份日志全是编排器写的，一份都还没落地；
//   4. get_launch_status 读不到文件只返回 Err，**区分不了**「编排器还没写」
//      与「项目根 / 路径不对」。
//
// 结果就是启动页截图里那一幕：面板写着「暂时读不到日志」，并让用户去翻
// run/launch-status.json 与 log/launcher/dev-launcher.log —— 而那两处恰恰
// 是空的那两处。诊断信息指向了自己缺席的地方。
//
// ## 判据放哪
//
// 本模块是**纯函数 + 薄 fs 适配**：路径推导、常驻快照内容、报告行与日志行
// 形态、清单文案都是纯函数（可枚举、可单测、无 IO），只有 writeStatusFile /
// appendLaunchLog 这类一两行触盘才是适配。Rust 侧（src-tauri/src/lib.rs）
// 在这里有对应的一份实现 —— 两侧共用的是**同一组路径与形态常量**（本文件旁的
// launch-diagnostics.paths.json 由 tests/launch-diagnostics-paths.test.ts 与
// Rust 侧逐项核对），因此不存在「同一判据两份会漂的实现」。

import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

import { formatLocalStamp } from "~/lib/time-format";

/** 启动阶段（与 run/launch-status.json 的 phase 同域，另加壳侧自有的两档）。 */
export type LaunchPhase =
  /** 壳刚接手：还没写任何状态。 */
  | "shell-boot"
  /** 壳正在检查这个检出能不能自己起（编排脚本 / 依赖）。 */
  | "shell-prepare"
  /** 壳已把编排器拉起来，等它写第一份状态。 */
  | "shell-orchestrating"
  /** 壳决定自编排走不通，把原因留给启动页。 */
  | "error";

/** 启动页在「壳已接手、编排器还没写字」这段空档期里的兜底快照。 */
export interface LaunchFallback {
  /** 阶段标签（启动页的 PHASE_LABELS 直接消费）。 */
  phase: LaunchPhase;
  /** 进度 0~1；判据是 progress < 1 —— 大于等于 1 会被启动页画成「✓」。 */
  progress: number;
  message: string;
  error: boolean;
  /** 标记这是壳的常驻快照（不是编排器的权威进度）。 */
  fallback: true;
  /** 诊断出口（壳写下的路径，页面不自己拼）——见 idleFallback 的说明。 */
  diagnostics: {
    projectRoot: string;
    launchLog: string;
    shellLog: string;
    statusFile: string;
  };
}

export interface LaunchPaths {
  /** 项目根（<root>/run 与 <root>/log 的锚点）。 */
  root: string;
  /** run/launch-status.json：编排器与壳共写的进度文件。 */
  statusFile: string;
  /** log/launcher/：编排日志目录。 */
  launcherDir: string;
  /** 编排器「本次运行」日志（dev-launcher.log）。 */
  orchestratorLog: string;
  /** 编排器当前日志的 sentinel（dev-launcher-current.txt）。 */
  orchestratorSentinel: string;
  /** 编排器 stderr 与壳 stderr 共用文件（dev-launcher-stderr.log）。 */
  orchestratorStderr: string;
  /** 壳自持日志（release，log/shell/shell.log）。 */
  shellLog: string;
  /** 壳侧编排链路日志（log/launcher/shell-launch.log）。 */
  shellLaunchLog: string;
}

/**
 * 项目根下的启动链路路径。
 *
 * 收在一处而不是各处 path.join(root, "log", "launcher", …)：Rust 侧
 * （get_launch_log）与 Node 侧读的是**同一批文件**，两份手拼的路径一旦漂开，
 * 表现是「日志明明写了、面板却读不到」—— 而这类漂移在两侧各自看都「是对的」。
 */
export function launchPaths(root: string): LaunchPaths {
  const launcherDir = path.join(root, "log", "launcher");
  return {
    root,
    statusFile: path.join(root, "run", "launch-status.json"),
    launcherDir,
    orchestratorLog: path.join(launcherDir, "dev-launcher.log"),
    orchestratorSentinel: path.join(launcherDir, "dev-launcher-current.txt"),
    orchestratorStderr: path.join(launcherDir, "dev-launcher-stderr.log"),
    shellLog: path.join(root, "log", "shell", "shell.log"),
    shellLaunchLog: path.join(launcherDir, "shell-launch.log"),
  };
}

/** 报告里要展示的一项（key + value，启动页按原样落在日志面板里）。 */
export interface LaunchReportItem {
  key: string;
  value: string;
}

/**
 * 壳接手那一刻的常驻快照。
 *
 * 它替代的是「编排器还没写 = 什么都没有」：启动页读到 fallback 标记就知道
 * 这是壳的快照（不是权威进度），既能显示「壳在做什么」，也能在编排器卡死时
 * 从快照里读出**它本来要起什么、日志会写在哪**。
 *
 * 快照**必须自带 `diagnostics`**（与 `no_status_payload` 同形）：编排器一旦写
 * 自己的 `launch-status.json`，这份快照就被整份顶掉（它不带 diagnostics），
 * 而它写第一份日志之前磁盘上恰恰什么都没有 —— 那段窗口期里启动页能拿到的
 * 现场只有这份快照里的路径与启动报告（ISSUE #784 手验反馈）。
 */
export function idleFallback(
  phase: LaunchPhase = "shell-prepare",
  root = "",
): LaunchFallback {
  return {
    phase,
    // **必须 < 1**：启动页把 pct >= 100 画成「✓」，一个常驻快照若标成 100%
    // 会让「还在启动」看起来像「启动完了」。
    progress: 0,
    message: "桌面壳已接手启动编排，正在拉起本地服务…",
    error: false,
    fallback: true,
    diagnostics: fallbackDiagnostics(root),
  };
}

/** 编排器已拉起、等它写第一份状态时的快照。 */
export function orchestratingFallback(root = ""): LaunchFallback {
  return {
    phase: "shell-orchestrating",
    progress: 0,
    message: "正在等待本地服务就绪（编排器已启动，诊断见「查看日志」）…",
    error: false,
    fallback: true,
    diagnostics: fallbackDiagnostics(root),
  };
}

/**
 * 快照自带的诊断出口（与 Rust 侧 `write_idle_status` / `no_status_payload`
 * 写的是同一组键）。
 *
 * 它存在的意义是「快照被顶掉之前，现场已经在磁盘上了」：用户读到的
 * `run/launch-status.json` 在双击后的头两秒就是这一份，点「查看日志」时
 * 面板也照它去取。
 */
export function fallbackDiagnostics(root: string): {
  projectRoot: string;
  launchLog: string;
  shellLog: string;
  statusFile: string;
} {
  const paths = launchPaths(root);
  return {
    projectRoot: root,
    launchLog: paths.shellLaunchLog,
    shellLog: paths.shellLog,
    statusFile: paths.statusFile,
  };
}

/**
 * 把壳的启动报告渲染成面板里的一行。
 *
 * 面板在做诊断，因此**逐项一行**而不是塞成一行：用户贴图 / 贴文本反馈时，
 * 「哪一项对不上」要能一眼看出来。空值写 (空) 而不是留白 —— 留白在这类报告里
 * 恰好是最需要看见的信息（「项目根没推出来」就是这么表现的）。
 */
export function formatReportItem(item: LaunchReportItem): string {
  return `${item.key}: ${item.value === "" ? "(空)" : item.value}`;
}

/**
 * 给编排链路日志加时间戳前缀。
 *
 * 形态与 log/services/*.log 同族（[本地时刻] [级别] 正文），便于与编排器自己写的
 * 那份按时间对齐 —— 壳的行与编排器的行读起来是一条时间线。
 *
 * 时间戳**不在这儿拼**：日志行首的形态与「用本地时间而不是 UTC」这条判据都在
 * `~/lib/time-format` 的 `formatLocalStamp`（那边收着 6 处曾逐字重复的实现，
 * 见其注释）。这里手拼一遍就是第七处 —— 且会立刻踩上同一个坑（`toISOString()`
 * 在 +8 时区凭空差 8 小时，用户对照本机时钟会以为日志串了日期）。
 */
export function formatLogLine(
  level: string,
  message: string,
  now: Date = new Date(),
): string {
  return `[${formatLocalStamp(now, { millis: true })}] [${level.toUpperCase()}] ${message}`;
}

/** 摘掉日志行尾的换行（报告项的值来自带换行的原始内容）。 */
export function trimReportValue(value: string): string {
  return value.replace(/\r?\n+$/, "");
}

/**
 * 启动页面板「按顺序看这几处」的清单。
 *
 * 用户在截图里被指向 log/launcher/dev-launcher.log，而当时真正有内容的正是
 * **壳自持**的那一份 —— 清单必须把这一层写在最前面，否则「按提示查了、还是
 * 没有」会重复发生（ISSUE #784 手验反馈正是这么来的）。
 */
export function logHintLines(paths: LaunchPaths): string[] {
  return [
    `  1) 壳侧编排链路（壳自己写的，启动期最先有内容）：${paths.shellLaunchLog}`,
    `  2) 编排日志（编排器起来后才有）：${paths.orchestratorLog}`,
    `  3) 编排错误输出：${paths.orchestratorStderr}`,
  ];
}

/**
 * 判据：这份状态是不是**壳的常驻快照**（而不是编排器的权威进度）。
 *
 * 快照只服务「壳已接手、编排器还没写字」这段窗口期，因此消费方要能一眼认出它、
 * 并且**不能**拿它当就绪判据。后续阶段字段与 `phase` 字段都要看：`fallback`
 * 是壳写的显式标记，`no-status-file` 是壳在状态文件缺席时给的兜底（连文件都
 * 没有，更谈不上权威）。
 */
export function isShellFallbackStatus(status: {
  fallback?: unknown;
  phase?: unknown;
}): boolean {
  return status.fallback === true || status.phase === "no-status-file";
}

/** 落盘用的适配：写常驻快照（目录缺失时递归建）。返回是否成功。 */
export function writeStatusFile(file: string, payload: unknown): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(payload), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 落盘用的适配：追加一行编排链路日志（目录缺失时递归建）。 */
export function appendLaunchLog(file: string, line: string): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
