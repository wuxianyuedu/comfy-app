/**
 * `src/lib/**` 的 Node-only 声明规则（规范 §18.4「唯一口径」，ISSUE #572 第 1 项）。
 *
 * 背景：同一件事此前有**三套写法并存**且没有任何文档说明何时用哪个 ——
 *   `.server.ts` 后缀（7 个文件）/ 顶层 `import "server-only"`（21 个文件）/
 *   两者都没有（14+ 个顶层 `import fs` 的模块）。第三个形态不是风格问题：
 *   `log-session-scope.ts` 顶层 `node:fs` 被客户端组件引到，Turbopack 把
 *   `node:fs` 整图形入浏览器 chunk，`/login` 与 `/workspace` **整页 500**
 *   （ISSUE #317 / #282）。
 *
 * 本用例把 §18.4 的三分类**变成机器判据**：
 *
 *   A. 声明形态 → 最窄的那条路径**都引不到它**（`lib-*-only` 入口不可达）
 *   B. 纯模块   → 客户端可达图中也不能出现（webpack/turbopack 不采样该路径，
 *                只有真被引到才红）
 *   C. 纯 Node 宿主 → **显式登记**，且登记项会反向核对（清单只许变短）
 *
 * 为什么必须走「可达性」而不是「扫 `import fs` 就要求 `server-only`」：
 * `eslint-plugin-boundaries` 的 import 图**对服务端源码完全不采样**
 * （实测：给 `src/lib/log/log-paths.ts` 加 `import "server-only"` 后 `pnpm lint` 仍绿），
 * 于是「扫到 fs 就要求声明」的写法**没有任何门禁能替它兜底** —— 而 §18.4 的
 * 第三类（纯 Node 宿主）本来就不该带 `server-only`（它的入口是一句 `throw`，
 * 加上去 `scripts/*.mjs` 的启动编排会直接崩）。判据必须区分「真的可能被打包
 * 进浏览器」与「只由纯 Node 宿主加载」，这只有走依赖图才能知道。
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

/** §18.4 第二类：纯 Node 宿主（由 `scripts/*.mjs` 动态加载，不经 Next 打包）。 */
const PURE_NODE_HOSTS = [
  // 壳侧启动链路的路径 / 行形态 / 常驻快照内容（ISSUE #784）：
  //   · 它服务的两个消费方都**不是** Next 页面 —— 面板读同一份路径靠 Rust 侧的
  //     对应实现（`src-tauri/src/shell_launch.rs`，两侧逐项同形），而「壳会往
  //     哪写」是构建期已被嵌进 exe 的常量；
  //   · 文件句柄（`mkdirSync` / `appendFileSync`）只由壳侧宿主进程触达，浏览器
  //     侧不可能也做不到；
  //   · 加 `server-only` 会把「这本模块是构建期/壳侧常量」这件事说反（它的入口
  //     会 throw），因此按 §18.4 第三类登记。
  "src/lib/shell/launch-diagnostics.ts",
  "src/lib/process/kill-process-tree.ts",
  // workshop MCP：由 tools/mcp-{stdio,http}.ts 经 `tsx` 直接跑，**不经 Next**；
  // 它必须与 Next 侧共用同一份密文实现（`src/server/workshop/llm.ts` 也引它），
  // 因此不能带 server-only（那会让 MCP 宿主直接 throw）。
  "src/lib/llm/secrets.ts",
  // P3 executor host 迁移第 1 期·第三步：`runner-state.ts` 的 server-only 已摘，
  // 与 `kill-process-tree.ts` 同族登记为第三类。
  //   · 顶层 `import { EventEmitter } from "events"` 是**故意保留的值 import**
  //     —— `state()` 内部构造 emitter 需要它，是执行链的唯一 emitter 归属点；
  //   · Next server 目前是唯一宿主（route handler / tRPC / instrumentation 都走
  //     Next 的 react-server 条件），P3 §5 第 2 期的 `scripts/executor-host.mjs`
  //     会作为第二宿主接入；
  //   · 真正的 server-only 依赖（`taskRepository` / `logger`）已从静态值 import
  //     降级为 `resolveDeps()` 里的 `await import(...)` —— scanner 的 parseImports
  //     不识别 dynamic 形态，因此本模块既不进 `clientReachable`，也不会把
  //     Next 侧 server-only 依赖暴露成 `libOnlyReachable`；
  //   · 一旦给它补 `server-only`，纯 Node 侧的 import 就是入口 throw——正是
  //     规范 §18.4 「纯 Node 宿主两者都不加」的原型。
  "src/lib/comfyui/runner-state.ts",
  // P3 迁移第 1 期·第三步（叶模块批）：以下三个都只有 Node 内建 value import
  // （`child_process` / `fs` / `path`），完全**不引** server-only 侧模块；
  // 摘掉 server-only 后按第三类登记。语义与 `kill-process-tree.ts` 同族——
  // 都是「本机进程 / 环境探测」的地基层，本来就该被 Next server 与未来
  // `scripts/executor-host.mjs` 双宿主加载。
  //   · `gpu-vram.ts`：nvidia-smi 探测本机显存（供底部状态栏对照）。
  //   · `launch-path.ts`：从 comfyuiPath 推导「源码根 + Python 解释器」的纯解析。
  //   · `proc-detect.ts`：`/proc/net/tcp` + `netstat` 查 PID 监听端口，POSIX /
  //     Windows 各自走本机自带工具，不依赖 lsof。
  "src/lib/comfyui/gpu-vram.ts",
  "src/lib/comfyui/launch-path.ts",
  "src/lib/comfyui/proc-detect.ts",
  // trace.ts：诊断通道，落盘路径 `COMFYUI_TRACE_LOG` 从 `~/lib/log/log-paths`
  // （server-only）拿。P3 迁移第 1 期·第三步把它改成**加载即 fire-and-forget 的
  // 动态 import** 填模块内 ref；同时导出 `configureTraceLogPath(p)`，让未来
  // executor host 显式注入路径、不必依赖那条 dynamic 边（在纯 Node 下它会撞
  // log-paths 里的 server-only throw、被 `.catch(() => undefined)` 咽下）。
  // trace() 保持同步，ref 未 ready 时静默 skip——与既有硬约束「诊断通道不得
  // 因磁盘/权限把生成带崩」完全一致，旧行为里写盘失败也是 catch 掉不抛。
  "src/lib/comfyui/trace.ts",
  // executor-finalize.ts：P3 第 1 期·第三步·收口批。摘掉 server-only 后本模块
  // **自身**的静态边已解——taskRepository / getView / createAppRuntimeLogger
  // 三条 server-only 侧依赖全改成「首次调用时 dynamic import + 允许
  // `configureExecutorFinalize` 注入」。Node 内建 fs/path 值 import 保留。
  // ⚠️ 但**传递闭包**里 `./client`、`./executor-history`、`./executor-continuation`
  // 各自还静态引 server-only 侧（logger → app-runtime-log → server-only throw、
  // client → logger 同链），因此登记进本清单**不是**「现在就能在纯 Node 里
  // import 本模块」的承诺，只是「标迁移方向 + 消化 scanner 的 unguarded」；
  // 后续 PR 把 client / executor-history / executor-continuation 拆完后，
  // 本模块才能真正被纯 Node 宿主加载。
  "src/lib/comfyui/executor-finalize.ts",
  // executor-cli.ts：P3 第 1 期·第三步·执行批。摘掉 server-only 后本模块**自身**
  // 的静态边已解——logger（走加载即 fire-and-forget + `cliWarn` 静默 skip）、
  // taskRepository / resolveComfyBase（在 `executeViaComfyCli` 顶部一次性
  // resolve、下游 closure 沿用旧名）三条 lazy + `configureExecutorCli` 注入。
  // 顶层 Node 内建值 import 有 `child_process` / `fs` / `path`（spawn comfy-cli
  // 子进程 + 读写临时工作流文件），因此落进 unguarded、按第三类登记。
  // 与 executor-finalize 同一族：传递闭包（./client / ../core/repository 各自
  // 仍静态引 server-only 侧）留在后续 PR 拆完；本登记**不是**「现在能在纯 Node
  // 里 import 本模块」的承诺。
  "src/lib/comfyui/executor-cli.ts",
  // log-paths.ts：P3 迁移第 1 期·lib 层地基批。摘掉 server-only 后本模块走
  // §18.4 第三类——只有 `path` 一条 Node 内建值 import、其它全是 `path.join`
  // 常量。它**是整链 logger 的地基**：`logger` 通过 `app-runtime-log` 静态
  // 引它、`session-banner.server` / `capture-streams.server` 也引它、
  // `comfyui/lifecycle` / `comfyui/trace` 也引它——只要 log-paths 带 server-only，
  // 纯 Node 里 `await import("~/lib/core/logger")` 的 promise 会因这一层的
  // throw 而 reject、上层 comfyui 各模块的 lazy 兜底接不进去。摘掉之后
  // 整条 lazy 链能真跑起来（下一步：app-runtime-log 摘 server-only）。
  // 「浏览器图别引我」的约束不再靠 server-only 兜——由 scanner 的 clientReachable
  // 判据盯（`path` 命中即红），与 `kill-process-tree.ts` 同族。
  "src/lib/log/log-paths.ts",
  // app-runtime-log.ts：P3 迁移第 1 期·lib 层地基批的第二站。它是 logger
  // 链最近的一层——`~/lib/core/logger` **静态引**本模块（把 ERROR 级消息镜像
  // 落到 `log/services/app-runtime.log`，见规范 07 §7.11），只要它带
  // server-only，`await import("~/lib/core/logger")` 在纯 Node 里就 throw、
  // 前 3 批 comfyui 各模块（#1053 / #1068 / #1071）的 lazy 兜底接不进去。
  // 上游 log-paths 已在 #1074 摘（本模块静态引它拿 APP_RUNTIME_LOG 常量），
  // 本模块自身只有 `node:fs` / `node:path` + `~/lib/time-format` 三条依赖，
  // 全部纯 Node 可加载，摘 server-only 走 §18.4 第三类登记。
  "src/lib/log/app-runtime-log.ts",
  // P3 迁移第 1 期·lib 层地基批·二级叶模块（5 个）：
  //   · `comfyui/instance-kind`：只依赖 `fs` / `path`。
  //   · `comfyui/env-python`：`fs` / `os` / `path` + 纯函数 `~/lib/path-display`。
  //   · `comfyui/lifecycle-exit`：`fs` + `./proc-detect` 的 type-only import。
  //   · `comfyui/desktop-instance`：`fs` / `os` / `path` + 同批 instance-kind。
  //   · `shell/open-in-browser`：`child_process` + 纯函数 `~/lib/error-message`。
  // 全都不引 server-only 侧模块、也不引业务侧的 logger / repository，形态与
  // `kill-process-tree` / `log-paths` 同族；这一批清完 comfyui 与 shell 目录下
  // 的**二级叶**，client / status / lifecycle-launch 等**汇聚点**的传递边就能
  // 自然解（它们静态引的就是这几个）。
  "src/lib/comfyui/instance-kind.ts",
  "src/lib/comfyui/env-python.ts",
  "src/lib/comfyui/lifecycle-exit.ts",
  "src/lib/comfyui/desktop-instance.ts",
  "src/lib/shell/open-in-browser.ts",
  // P3 迁移第 1 期·lib 层地基批·汇聚点（3 个）：
  //   · `comfyui/status`：ComfyUI 运行态快照的**四路判据汇聚点**（HTTP 探测 /
  //     进程表 / 桌面元数据 / 环境反查）。它的静态依赖全部在 comfyui 前 8 批
  //     与本批前段（instance-kind / env-python / desktop-instance / log-paths /
  //     app-runtime-log）中纯化了；logger 走 `~/lib/core/logger`（3rd class）。
  //   · `comfyui/lifecycle-launch`：ComfyUI 拉起路径的**编排**（bound/keepAlive
  //     两种模式），静态引 process-launch、log-paths、launch-path、proc-detect、
  //     desktop-instance、lifecycle-exit、logger —— 全 3rd class 或 pure。
  //     host（`LaunchHost`）注入是它既有的架构（不引 lifecycle.ts 避成环）。
  //   · `process/process-launch`：与 `kill-process-tree.ts` 同目录同族的
  //     **spawn 侧**（bound/keepAlive + PowerShell Start-Process 中介）。
  //     这一批把 lifecycle-launch 的最后一颗钉子拆掉。
  "src/lib/comfyui/status.ts",
  "src/lib/comfyui/lifecycle-launch.ts",
  "src/lib/process/process-launch.ts",
];

type Report = {
  unguarded: string[];
  libOnlyReachable: { module: string; chain: string[] }[];
  clientReachable: { module: string; chain: string[] }[];
  counts: Record<string, number>;
};

/** 跑一次可达性分析（实现收在 `scripts/lib-node-only-scan.mjs`，本用例不复制一份）。 */
function scan(): Report {
  const out = execFileSync(
    process.execPath,
    ["scripts/lib-node-only-scan.mjs", "--json"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(out) as Report;
}

describe("src/lib 的 Node-only 声明（规范 §18.4）", () => {
  const report = scan();

  it("顶层 import Node 内建的模块都必须有声明（§18.4 三选一，不许都没有）", () => {
    // 第三类的**唯一**出口是下面的显式登记；这里先判「有没有声明」。
    const offenders = report.unguarded.filter(
      (rel) => !PURE_NODE_HOSTS.includes(rel),
    );
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
      `以下模块声明为「只能服务端用」却仍被纯模块可达：\n` +
        hits
          .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("纯模块不得出现在客户端可达图中（会整页 500）", () => {
    const hits = report.clientReachable;
    expect(
      hits,
      `以下模块被 \`"use client"\` 入口静态引用且顶层 import 了 Node 内建 —— ` +
        `Turbopack 会以 "does not support external modules" 让整页 500：\n` +
        hits
          .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
          .join("\n"),
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
