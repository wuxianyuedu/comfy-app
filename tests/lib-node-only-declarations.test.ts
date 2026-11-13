/**
 * `src/lib/**` 的 Node-only 声明判据（规范 §18.4，ISSUE #572）：A 声明形态须在最窄入口不可达、B 纯模块
 * 须不在客户端可达图（webpack/turbopack 不采样该路径）、C 纯 Node 宿主须显式登记且清单只许变短。走依赖图而非
 * 「扫 import fs 就要求声明」：boundaries 对服务端源码不采样（#317/#282 让 node:fs 进浏览器 chunk 致整页 500），第三类加了会 throw。
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

const REPO_ROOT = process.cwd();

/** §18.4 第二类：纯 Node 宿主（由 `scripts/*.mjs` 动态加载，不经 Next 打包）。 */
const PURE_NODE_HOSTS = [
  // 壳侧启动链路的路径 / 行形态 / 常驻快照（ISSUE #784）：消费方都非 Next 页面 —— 面板读同一份路径靠
  // Rust 侧 `src-tauri/src/shell_launch.rs` 逐项同形，写入点是构建期常量；句柄只由壳侧宿主触达。
  // 加 `server-only` 会把「本模块是构建期/壳侧常量」说反（入口会 throw），按 §18.4 第三类登记。
  "src/lib/shell/launch-diagnostics.ts",
  // reveal-path.ts（ISSUE #1365）：日志行里点路径 → 在文件管理器里定位。顶层 value import 有 `child_process`
  // （spawn explorer/open/xdg-open）/ `fs`（判存在）/ `path`（Linux 取父目录），消费方是 tRPC 路由。加 `server-only`
  // 不多保护什么，却会让「同一份实现被纯 Node 宿主加载」直接 throw；与 `open-in-browser.ts` 的区别只是后者仅被
  // `src/server/**` 引（越界登记停在那一层），兄弟件 `~/lib/log/log-path-tokens.ts` 须能独立加载。
  "src/lib/shell/reveal-path.ts",
  "src/lib/process/kill-process-tree.ts",
  // workshop MCP：由 tools/mcp-{stdio,http}.ts 经 `tsx` 直接跑，**不经 Next**；
  // 它必须与 Next 侧共用同一份密文实现（`src/server/workshop/llm.ts` 也引它），
  // 因此不能带 server-only（那会让 MCP 宿主直接 throw）。
  "src/lib/llm/secrets.ts",
  // P3 §5 ADR §14 D1：`runner-state.ts` 的 EventEmitter 已退役、不再顶层 import Node 内建值，登记随之撤掉；
  // 但「不许带 `server-only`」不变 —— 带上会让 host 侧 `bootRuntime()` 注入链加载它时 throw。
  // P3 迁移第 1 期·第三步（叶模块批）：以下三个只有 Node 内建 value import（`child_process`/`fs`/`path`），
  // 不引 server-only 侧模块；与本机进程探测地基同族，须被 Next server 与未来 `scripts/executor-host.mjs` 双宿主加载。
  // `gpu-vram.ts`（nvidia-smi 显存）/ `launch-path.ts`（comfyuiPath 推导源码根+解释器）/ `proc-detect.ts`（查监听端口）。
  "src/lib/comfyui/gpu-vram.ts",
  "src/lib/comfyui/launch-path.ts",
  // comfy-cli-python.ts（ISSUE #1239）：与 `launch-path.ts` 同族的纯解析地基 —— 从设置项 `comfyCliPython`
  // 推导解释器落点、按形态给「找不到」提示。只有 `node:path` 一条 value import、不引 server-only 侧模块；
  // 消费方是本清单第三类的 `executor-cli.ts`，桌包里跑在纯 Node 宿主，故按第三类登记而非 `server-only`。
  "src/lib/comfyui/comfy-cli-python.ts",
  "src/lib/comfyui/proc-detect.ts",
  // trace.ts：诊断通道，落盘路径 `COMFYUI_TRACE_LOG` 从 server-only 的 `~/lib/log/log-paths` 拿。P3 第 1 期·
  // 第三步改成加载即 fire-and-forget 的 dynamic import 填 ref，并导出 `configureTraceLogPath(p)` 供宿主注入；
  // 纯 Node 下那条 dynamic 边会撞 server-only throw、被 `.catch` 咽下。trace() 保持同步，ref 未 ready 时静默 skip
  // （硬约束「诊断通道不得把生成带崩」，旧行为写盘失败也是 catch 掉不抛）。
  "src/lib/comfyui/trace.ts",
  // executor-finalize.ts：P3 第 1 期·第三步·收口批。摘掉 server-only 后**自身**静态边已解 —— taskRepository /
  // getView / createAppRuntimeLogger 三条改成首次调用时 dynamic import + `configureExecutorFinalize` 注入。
  // ⚠️ 传递闭包里 `./client`、`./executor-history`、`./executor-continuation` 仍静态引 server-only 侧，
  // 故登记**不是**「现在就能在纯 Node 里 import 本模块」的承诺，只是标迁移方向 + 消化 scanner 的 unguarded。
  "src/lib/comfyui/executor-finalize.ts",
  // output-paths.ts：任务产物布局（落盘目录 / 产物 URL / 删除目标）的唯一一份定义，必须同时被落盘侧
  // （`executor-finalize.ts`）与读删侧（`src/server/api/routers/task.ts` 的 openFolder / delete）静态 import：
  // 布局分成两处就会出现「落盘认 `projects/<pid>/<tid>`、删除只认 `<tid>`」的分叉（本批修的就是它）。
  // 给落盘侧那条边挂 `server-only` 等于把约束重新拆开；它只有 `path` 一条 value import，浏览器图由 clientReachable 盯。
  "src/lib/media/output-paths.ts",
  // executor-cli.ts：P3 第 1 期·第三步·执行批。摘掉 server-only 后**自身**静态边已解 —— logger（fire-and-forget +
  // `cliWarn` 静默 skip）、taskRepository / resolveComfyBase 两条 lazy + `configureExecutorCli` 注入。
  // 顶层 value import 有 `child_process`/`fs`/`path`，落进 unguarded、按第三类登记。与 executor-finalize 同族：
  // 传递闭包（./client / ../core/repository 仍静态引 server-only）留后续 PR，本登记不是「现在能纯 Node import」。
  "src/lib/comfyui/executor-cli.ts",
  // log-paths.ts：P3 迁移第 1 期·lib 层地基批，按 §18.4 第三类 —— 只有 `path` 一条 value import，其余是常量。
  // 它**是整链 logger 的地基**（logger → app-runtime-log、`*.server`、`comfyui/lifecycle`、`comfyui/trace` 都引它）：
  // 带 server-only 时纯 Node 里 `await import("~/lib/core/logger")` 会因这层 throw 而 reject、comfyui 的 lazy 兜底接不进去。
  // 摘掉后整条 lazy 链能真跑（下一步 app-runtime-log）；浏览器图约束由 scanner 的 clientReachable 盯。
  "src/lib/log/log-paths.ts",
  // app-runtime-log.ts：P3 迁移第 1 期·lib 层地基批第二站，logger 链最近的一层 —— `~/lib/core/logger` **静态引**它
  // 把 ERROR 镜像落到 `log/services/app-runtime.log`（规范 07 §7.11）。带 server-only 时纯 Node 里 logger 的
  // import 会 throw，前 3 批 comfyui 模块（#1053/#1068/#1071）的 lazy 兜底接不进去。上游 log-paths 已在 #1074 摘，
  // 本模块只有 `node:fs`/`node:path`/`~/lib/time-format`，全可纯 Node 加载，故走第三类登记。
  "src/lib/log/app-runtime-log.ts",
  // P3 迁移第 1 期·lib 层地基批·二级叶模块（5 个）：`comfyui/instance-kind`（fs/path）、`comfyui/env-python`
  // （fs/os/path + `~/lib/path-display`）、`comfyui/lifecycle-exit`（fs + 同批 proc-detect 的 type-only）、
  // `comfyui/desktop-instance`（fs/os/path + 同批 instance-kind）、`shell/open-in-browser`（child_process + 纯函数）。
  // 全不引 server-only 侧模块与业务 logger/repository；这批清完 comfyui 与 shell 的二级叶，汇聚点的传递边自然解。
  "src/lib/comfyui/instance-kind.ts",
  "src/lib/comfyui/env-python.ts",
  "src/lib/comfyui/lifecycle-exit.ts",
  "src/lib/comfyui/desktop-instance.ts",
  "src/lib/shell/open-in-browser.ts",
  // P3 迁移第 1 期·lib 层地基批·汇聚点（3 个）：`comfyui/status` —— ComfyUI 运行态快照的四路判据汇聚点
  // （HTTP 探测 / 进程表 / 桌面元数据 / 环境反查），静态依赖已在前 8 批与本批前段纯化，logger 走 3rd class
  // `~/lib/core/logger`；`comfyui/lifecycle-launch` —— 拉起路径编排（bound/keepAlive），依赖全 3rd class 或 pure，
  // host（`LaunchHost`）注入是既有架构（不引 lifecycle.ts 避成环）；`process/process-launch` —— 同族 spawn 侧
  // （bound/keepAlive + PowerShell Start-Process 中介），本批把 lifecycle-launch 最后一颗钉子拆掉。
  "src/lib/comfyui/status.ts",
  "src/lib/comfyui/lifecycle-launch.ts",
  "src/lib/process/process-launch.ts",
  // `comfyui/cpu-limit-apply.ts`（ISSUE #1959）：把 CPU 档位施加到已拉起的 ComfyUI 子进程 —— 只有
  // `child_process.execFile` 一条 value import（renice / taskset / WMI 优先级），不引 server-only 侧模块。
  // 与同目录 `proc-detect.ts` 同族（本机进程能力薄封装），须被 Next server 与未来 `scripts/executor-host.mjs`
  // 双宿主加载，加 `server-only` 会让那条宿主路径加载即 throw。判据（档位 → 命令）在纯模块 `./cpu-limit`，
  // 零 Node 内建 import，刻意不登记。
  "src/lib/comfyui/cpu-limit-apply.ts",
  // `lifecycle.ts` 自身**不再**在册：它把那两件「加载即求值」的落盘活（上次会话
  // 标记的 `COMFY_SESSION_MARK`、本次 runtime 日志写入器）搬进了
  // `lifecycle-session-log.ts`，顶层 Node 内建 import 随之清零（scanner 不再把它
  // 读成 offenders）。搬走的理由见那个文件头注；这条登记按「清单只许变短」的判据
  // 同步删掉 —— 留着它就是一条已失效的登记。
  "src/lib/comfyui/lifecycle-session-log.ts",
  // `lifecycle-session-log.ts`：从 `lifecycle.ts` 按职责拆出的「会话落盘两件事」
  // （上次会话标记 + 本次 runtime 日志写入器，都只做读回与写盘）。它顶层 import 的
  // 是 `fs` / `~/lib/log/log-paths` / `~/lib/log/runtime-log-pack.server`——与
  // `lifecycle.ts` 一字不差的同一条静态边，形态按 §18.4 第三类，理由全同（见上面
  // 那条）；拆出来不给它换一种声明形态，否则「谁和谁同族」就成了拆文件时的副作用。
  "src/lib/comfyui/lifecycle-session-log.ts",
  // db-schema-ready.ts：P3 lib 地基批·reaper 侧最后一颗钉子。它是 rule 16 `comment.language.asciiOnly` 白名单
  // 成员（`docs/reference-facts.md` 登记），须保持纯 ASCII + 英文注释（`next-code-frame` 会渲染它，多字节高亮
  // 偏移会 panic）——**与 §18.4 三选一无关**。摘掉 server-only 后按第三类登记：`node:sqlite` DatabaseSync +
  // `node:path` + 纯函数；reaper 静态引 `isSchemaReady()`，带 server-only 时纯 Node host 加载即在这里 throw。
  "src/lib/db-schema-ready.ts",
  /* 应用内控制台（ISSUE #1327）：`console-run.ts` 顶层 `import { spawn } from "child_process"`。`console-registry.ts`
   * 只引 `./console-run` 与 `./console-limits` 两个纯模块、零 Node 内建 import，属「无需声明的纯模块」，不登记。
   * 按第三类而非 `server-only`：执行面回收必须走 `~/lib/process/kill-process-tree`（硬规则 3），那个模块本身是第三类，
   * 挂 `server-only` 会说反「同族」；且它的判据是单测里喂真进程断言输出/退出码/整树回收，带 server-only 得靠
   * `vi.mock("server-only")` 才加载得动，正是 §18.4 点名的「仪式化声明」。clientReachable 只盯到四个纯模块。 */
  "src/lib/console/console-run.ts",
  // executable-resolve.ts（ISSUE #1327）：可执行形态判据的唯一实现（`whichCommand` / `usableCommand` /
  // `pnpmInvocation` / `resolveCommandInvocation`），从 `scripts/launcher-core/shell.mjs` 搬下来 —— 同坑在应用内
  // 控制台又踩一次（直接 `spawn("pnpm")` 在 Windows 回 ENOENT）。顶层 value import 有 `child_process`/`fs`/`path`。
  // 必须能被 `.mjs` 静态 import（Node 24 类型擦除）：`shell.mjs` 是纯 Node 启动编排的一环，`server-only` 会让 `pnpm dev`
  // 崩在加载阶段；又要能被单测喂真实 `.cmd`/`.ps1`/shim，`.server.ts` 碍事。消费方 `console-run.ts` 与 `scripts/**` 均非 client 可达。
  "src/lib/process/executable-resolve.ts",
  // 上面两块从 `executable-resolve.ts` 按职责拆出（越过文件长度硬闸时切的），形态相同故一起登记：
  // `pnpm-resolve.ts` 顶层 import `fs`/`path`（读 `package.json` 的 `bin`）；`version-compare.ts` 零 Node 内建
  // import —— 扫描器按「顶层 import Node 内建」判，它本就不在 offenders 里，真正要登记的是前者。
  // 两者都必须能被 `.mjs` 静态 import（同一条跨宿主链）：`server-only` 会让启动编排加载即 throw，`.server.ts` 碍事。
  "src/lib/process/pnpm-resolve.ts",
  // `process/probe-exe.ts`（ISSUE #2316）：只依赖 `node:child_process` 的叶子 —— 一次 `spawnSync` 回答
  // 「这个候选真起得来吗、还是只是退非零 / 没量到」。消费方横跨测试侧（`tests/check-file-structure.test.ts`
  // 两处「这台机器有没有 PowerShell/Python」）、脚本侧（`scripts/python-probe.mjs`）与 `python-resolve.ts` 的失败
  // 形态类型；加 `server-only` 会让那两处起进程直接 throw，`.server.ts` 同样碍事，故按第三类登记。
  "src/lib/process/probe-exe.ts",
];

type Report = {
  clientReachable: Array<{ chain: Array<string>; module: string }>;
  counts: Record<string, number>;
  libOnlyReachable: Array<{ chain: Array<string>; module: string }>;
  unguarded: Array<string>;
};

/** 可达行（chain + module）的消费形状守卫（B5 清账）。 */
function isReachableRow(value: unknown): value is { chain: Array<string>; module: string } {
  return (
    isRecord(value) &&
    isUnknownArray(value.chain) &&
    value.chain.every((hop) => typeof hop === "string") &&
    typeof value.module === "string"
  );
}

/** 报告的消费形状守卫（B5 清账）：四个字段逐个对型，不再整段断言。 */
function isReport(value: unknown): value is Report {
  return (
    isRecord(value) &&
    isUnknownArray(value.clientReachable) &&
    value.clientReachable.every(isReachableRow) &&
    isRecord(value.counts) &&
    Object.values(value.counts).every((count) => typeof count === "number") &&
    isUnknownArray(value.libOnlyReachable) &&
    value.libOnlyReachable.every(isReachableRow) &&
    isUnknownArray(value.unguarded) &&
    value.unguarded.every((rel) => typeof rel === "string")
  );
}

/** 跑一次可达性分析（实现收在 `scripts/lib-node-only-scan.mjs`，本用例不复制一份）。 */
function scan(): Report {
  const out = execFileSync(process.execPath, ["scripts/lib-node-only-scan.mjs", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const parsed: unknown = JSON.parse(out);
  if (!isReport(parsed)) {
    throw new Error("lib-node-only-scan 的 JSON 报告形状变了 —— 重读脚本再改这份守卫");
  }
  return parsed;
}

describe("src/lib 的 Node-only 声明（规范 §18.4）", () => {
  const report = scan();

  it("顶层 import Node 内建的模块都必须有声明（§18.4 三选一，不许都没有）", () => {
    // 第三类的**唯一**出口是下面的显式登记；这里先判「有没有声明」。
    const offenders = report.unguarded.filter((rel) => !PURE_NODE_HOSTS.includes(rel));
    expect(
      offenders,
      `以下模块顶层 import 了 Node 内建模块，但既没有 \`import "server-only"\`、` +
        `也没有 \`.server.ts\` 后缀：\n${offenders.map((f) => `  ✗ ${f}`).join("\n")}\n` +
        `三选一（规范 §18.4）：① 全部出口只能服务端用 → \`import "server-only"\`；` +
        `② 同领域的服务端拆件 → \`.server.ts\` 后缀；` +
        `③ 纯 Node 宿主（由 scripts/*.mjs 动态加载）→ 正式登记进本用例的 PURE_NODE_HOSTS。`,
    ).toEqual([]);
  });

  it("声明过的模块，最窄的那条路径都引不到（声明不是装饰）", () => {
    // 判据：`lib` 侧入口 + 纯 Node 宿主 => 不可达。
    // 反向验证过它真的会红：给 `src/lib/log/log-paths.ts` 加 `import "server-only"`
    // 并把 `log-session-scope.ts`（纯）改成引它，立刻报出完整引用链。
    const hits = report.libOnlyReachable;
    expect(
      hits,
      `以下模块声明为「只能服务端用」却仍被纯模块可达：\n${hits
        .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("纯模块不得出现在客户端可达图中（会整页 500）", () => {
    const hits = report.clientReachable;
    expect(
      hits,
      `以下模块被 \`"use client"\` 入口静态引用且顶层 import 了 Node 内建 —— ` +
        `Turbopack 会以 "does not support external modules" 让整页 500：\n${hits
          .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
          .join("\n")}`,
    ).toEqual([]);
  });

  it("纯 Node 宿主登记项必须仍然成立（清单只许变短）", () => {
    for (const rel of PURE_NODE_HOSTS) {
      expect(
        report.unguarded,
        `${rel} 已带声明（server-only / .server.ts）—— 从 PURE_NODE_HOSTS 删掉它，` +
          `避免清单里躺着一条已失效的登记（会静默漂移的那种清单只许定义一次）`,
      ).toContain(rel);
    }
  });

  it("扫描器本身有效：三类形态都被它看见（不是「永远返回空」）", () => {
    // 反向验证：若扫描器只返回空数组，上面几条会全绿而毫无价值。
    expect(report.counts.nodeImports).toBeGreaterThan(30);
    expect(report.counts.guardedServerOnly).toBeGreaterThan(10);
    expect(report.counts.guardedServerSuffix).toBeGreaterThan(3);
  });
});
