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
