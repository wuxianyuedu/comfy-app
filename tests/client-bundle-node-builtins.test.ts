/**
 * 客户端 bundle 不得含 Node-only 模块（ISSUE #317 定位的 P0 回归）。
 *
 * 背景：`src/lib/log/log-session-scope.ts` 顶层 `import fs from "node:fs"`，而
 * 客户端组件 `LogProvider.tsx`（"use client"）只是想要它的纯函数
 * `clampLogTime`。Turbopack 编译浏览器 chunk 时把 `node:fs` 整图形入，报
 * 表现为 the chunking context does not support external modules (request: node:fs)
 * 并让 endpoint 编译失败——**`/login` 与 `/workspace` 整页 500**，应用完全
 * 打不开。这与 `app-runtime-log.ts` 的历史回归（ISSUE #282 / 规范 07 §7.12）
 * 同源，只是这次走的是「纯逻辑模块混进了 IO」这条更隐蔽的路。
 *
 * ── 判据的归属（ISSUE #569 第 2 项 / 规范 §18.4 的判定反模式）──────────────
 *
 * 这条判据**只有一份实现**：`scripts/lib-node-only-scan.mjs`。本文件此前把
 * 「哪些算 Node 内建 / 怎么解析 import / 从哪几个入口做 DFS」又抄了一份，于是
 * 同一件事有两份会各自漂移的判据 —— 而且**两份的盲区还不一样**（实测）：
 *
 *   · 旧的本文件：入口只取 `src/app/**` 与 `src/components/**` 里的
 *     `"use client"` 文件 —— `src/lib/llm/browser.ts`、`src/trpc/react.tsx`
 *     等 4 个 `"use client"` 入口**根本不在入口集里**；
 *   · 旧扫描器：入口是全 `src/**` 的 `"use client"`（更全），但 `reach()` 在
 *     **任何**已声明模块处就停 —— 而 `"use client"` 不是服务端边界，它是同一张
 *     客户端图里的另一个节点。于是 `src/trpc/query-client.ts`（只从
 *     `src/trpc/react.tsx` 可达）对扫描器**不可见**，对本文件反而可见。
 *
 * 两份判据各差一块、谁也不包含谁。修法不是「两边一起改」，而是**合并成一份**：
 * 扫描器的 `reach()` 改为只在 `server-only` / `.server.ts` 处停（`"use client"`
 * 继续走），入口取全 `src/**`；本文件改为**消费**扫描器的 JSON 输出，并把
 * 「客户端图要能穿过 `"use client"` 边界」这条反向验证钉住。
 *
 * 为什么不用 Turbopack 自己报错：那要跑完整构建（分钟级）且只在构建期可见；
 * 本用例调用扫描器是毫秒级、能给出引用链、可在 pre-commit 跑。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SRC = join(REPO_ROOT, "src");

type Report = {
  unguarded: string[];
  libOnlyReachable: { module: string; chain: string[] }[];
  clientReachable: { module: string; chain: string[] }[];
  counts: Record<string, number>;
};

/** 跑一次依赖图分析（实现收在扫描器里，本文件不复制一份 —— 见文件头的归属说明）。 */
function scan(): Report {
  const out = execFileSync(
    process.execPath,
    ["scripts/lib-node-only-scan.mjs", "--json"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(out) as Report;
}

/** 去掉注释，避免把注释里提到的 `node:fs` 误判成 import。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("客户端可达图中不得出现顶层 import Node 内建的模块", () => {
  const report = scan();

  it(
    "全仓扫描为绿（无客户端可达的 Node-only 模块）",
    () => {
      const hits = report.clientReachable;
      const detail = hits
        .map((h) => `  ✗ ${h.module}\n      引用链：${h.chain.join(" -> ")}`)
        .join("\n");
      expect(
        hits,
        `以下模块被客户端组件（或其依赖）静态引用，且顶层 import 了 Node 内建模块——\n` +
          `Turbopack 会以 "does not support external modules" 让整页 500。\n` +
          `修法：把纯逻辑（客户端要用的）与 IO（Node-only）拆成两个文件，\n` +
          `IO 那个放 <name>.server.ts（见 ISSUE #282 / #317 与规范 07 §7.12）。\n${detail}`,
      ).toEqual([]);
    },
    // 扫描器要逐文件读盘 + 解析（600+ 模块），全量并行负载下 5s 默认值不够
    30_000,
  );

  it("log-session-scope 已分层：纯函数模块不含 fs，IO 在 .server 模块", () => {
    // 这是本测试要守住的具体回归（ISSUE #317 的 P0）。
    const pure = readFileSync(join(SRC, "lib", "log", "log-session-scope.ts"), "utf8");
    expect(stripComments(pure)).not.toMatch(/from\s+["']node:fs["']/);
    // 纯函数仍可被客户端 import（clampLogTime 是 LogProvider 在用的）
    expect(pure).toContain("export function clampLogTime");
    expect(pure).toContain("export function resolveSessionStart");

    const server = readFileSync(join(SRC, "lib", "log", "log-session-scope.server.ts"), "utf8");
    expect(server).toMatch(/from\s+["']node:fs["']/);
    expect(server).toContain("export function fileMtimeMs");
  });

  it("入口是全 src/** 的 use client（不限于 app/components）", () => {
    // 反向验证入口集：`src/lib/shell/shell-tabs-store.ts` 是 `"use client"`，但它
    // **不在** `src/app|components` 下 —— 旧版本文件只从 app/components 收集入口，
    // 因此把 Node 内建注进它不会红。入口集改回窄口径，这条立刻红。
    const target = join(SRC, "lib", "shell", "shell-tabs-store.ts");
    const original = readFileSync(target, "utf8");
    expect(original).toMatch(/^\s*["']use client["']/m);
    try {
      writeFileSync(target, 'import fs from "node:fs";\n' + original);
      const probe = scan();
      const hit = probe.clientReachable.find(
        (h) => h.module === "src/lib/shell/shell-tabs-store.ts",
      );
      expect(
        hit,
        "扫描器的客户端入口集没有覆盖 src/lib 下的 use client 模块 —— " +
          "只从 src/app|components 收集入口会漏掉它们。",
      ).toBeDefined();
    } finally {
      writeFileSync(target, original);
    }
  });

  it("客户端图要能穿过 use client 边界（声明不是边界）", () => {
    // 反向验证锚点：`src/trpc/react.tsx` 是 `"use client"`，而
    // `src/trpc/query-client.ts` **只**从它出发才可达。扫描器若把
    // `"use client"` 当成停止点，这条路径就永远不可见 —— 判据静默失效
    // （这正是「两份判据互相补盲」里扫描器缺的那块）。
    //
    // 所以这里**真的注入一次**再撤掉：只看「扫描器认不认这条边」不够 ——
    // 一个永远把 clientReachable 返回空的实现也能过那种断言。
    const target = join(SRC, "trpc", "query-client.ts");
    const original = readFileSync(target, "utf8");
    try {
      writeFileSync(target, 'import fs from "node:fs";\n' + original);
      const probe = scan();
      const hit = probe.clientReachable.find(
        (h) => h.module === "src/trpc/query-client.ts",
      );
      expect(
        hit,
        '扫描器没有穿过 "use client" 边界：src/trpc/query-client.ts 只从 ' +
          'src/trpc/react.tsx（"use client"）可达，把它当停止点就会漏报。',
      ).toBeDefined();
      expect(hit?.chain.join(" -> ")).toContain("src/trpc/react.tsx");
    } finally {
      writeFileSync(target, original);
    }
  });
});
