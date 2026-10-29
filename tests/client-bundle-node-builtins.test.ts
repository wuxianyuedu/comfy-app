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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateRepo, expectGateRan } from "./helpers/gate-repo";

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
  const out = execFileSync(process.execPath, ["scripts/lib-node-only-scan.mjs", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return /* SAFETY: 类型断言已复核 */ JSON.parse(out) as Report;
}

/** 去掉注释，避免把注释里提到的 `node:fs` 误判成 import。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 两枚反向验证探针跑在**夹具树**上（ISSUE #2663）。
 *
 * 它们此前把 `import fs from "node:fs"` 注进真实入库文件
 * （`src/lib/shell/shell-tabs-store.ts` 与 `src/trpc/query-client.ts`）再在 `finally`
 * 里还原。#2593 管住了「还原的凭据」（不许拿 git 索引当凭据），**管不住读的那一侧**：
 * vitest 按文件并行，而 `tests/lib-node-only-declarations.test.ts` 在同一时刻扫的
 * 正是同一棵真实树 —— 探针写入的那一瞬被别人读成仓库事实。当场现场：
 * build `cnb-c25-1k62nch99` 报 `× src/lib/shell/shell-tabs-store.ts`
 * （那份文件在 `master` 上只有 `import { create } from "zustand"`），
 * 同一分支不改内容只重派生一次即绿（`cnb-8h5-1k62o407o`）。
 *
 * 出路只有「换一棵树」：独占 / 串行只把窗口调窄，第三份读同一棵真实树的用例出现时
 * 照撞（规范 §11.19 那条「并发与真实资源的隔离要一起改」是同一件事的另一半）。
 * 夹具树里「写」与「别人读」不是同一棵，窗口不存在。
 */
function runScanOnFixture(files: Record<string, string>): Report {
  const { repo, dispose } = createGateRepo({
    script: "lib-node-only-scan.mjs",
    dirs: ["src"],
  });
  try {
    for (const [rel, content] of Object.entries(files)) repo.write(rel, content);
    const r = repo.run(["--json"]);
    /* 先判「跑起来了」再判内容（拿不到测量不是判据红，§13.6.4）；
     * `--json` 那一档恒退 0，所以这一格退非 0 就是夹具或脚本坏了。 */
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    return /* SAFETY: 类型断言已复核 */ JSON.parse(r.output) as Report;
  } finally {
    dispose();
  }
}

/**
 * 判别位是那个 **lib 侧**的 `"use client"` 入口：入口集若退回「只收 app/components」，
 * 从 `page.tsx` 出发走不到 `src/lib/foo/pure-fs.ts`（它只挂在 lib 侧入口下面），
 * 这一格就红 —— 断的不是「目标被找到」，是「walk 的起点里有没有 lib」。
 */
const LIB_ENTRY_FIXTURE = {
  "src/app/only-shell/page.tsx":
    '"use client";\n\nimport { unrelated } from "~/lib/zzz/unrelated";\n\n' +
    "export default function Page() {\n  return unrelated();\n}\n",
  "src/lib/zzz/unrelated.ts": "export function unrelated() {\n  return 1;\n}\n",
  "src/lib/bar/tabs-entry.ts":
    '"use client";\n\nimport { touchFs } from "~/lib/foo/pure-fs";\n\n' +
    "export const entry = touchFs;\n",
  "src/lib/foo/pure-fs.ts":
    'import fs from "node:fs";\n\nexport function touchFs() {\n' +
    '  return typeof fs.existsSync === "function";\n}\n',
};

/**
 * 判别位是那个**夹在中间**的 `"use client"` 模块：扫描器若把声明当停止点，
 * `page.tsx → react-entry` 这一步就停住，`pure-leaf` 永远不可见 ⇒ 这一格红。
 * （旧扫描器缺的就是这一块 —— 见文件头那两段「两份判据各差一块」。）
 */
const CROSS_CLIENT_FIXTURE = {
  "src/app/x/page.tsx":
    '"use client";\n\nimport { reactEntry } from "~/trpc/react-entry";\n\n' +
    "export default function P() {\n  return reactEntry;\n}\n",
  "src/trpc/react-entry.ts":
    '"use client";\n\nimport { leaf } from "./pure-leaf";\n\n' +
    "export const reactEntry = leaf;\n",
  "src/trpc/pure-leaf.ts":
    'import fs from "node:fs";\n\nexport function leaf() {\n' +
    '  return typeof fs.readFileSync === "function";\n}\n',
};

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
    }, // 扫描器要逐文件读盘 + 解析（600+ 模块），全量并行负载下 5s 默认值不够
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
    /**
     * 钉的是「IO 在这一层、以这个名字出口」，不是它同不同步（ISSUE #2193 把它
     * 改成 `async` 之后，原来那条 `toContain("export function fileMtimeMs")`
     * 会在**与契约无关**的形状上红 —— 判据钉语义不钉行形状）。
     */
    expect(server).toMatch(/^export (?:async )?function fileMtimeMs/m);
  });

  it("入口是全 src/** 的 use client（不限于 app/components）", () => {
    /* 真实树里的锚点（只读）：这一形确实存在，判别位不是编出来的。 */
    expect(readFileSync(join(SRC, "lib", "shell", "shell-tabs-store.ts"), "utf8")).toMatch(
      /^\s*["']use client["']/m,
    );

    const report = runScanOnFixture(LIB_ENTRY_FIXTURE);
    const hit = report.clientReachable.find((h) => h.module === "src/lib/foo/pure-fs.ts");
    expect(
      hit,
      '扫描器的客户端入口集没有覆盖 src/lib 下的 "use client" 模块 —— ' +
        "只从 src/app|components 收集入口会漏掉它们（夹具里那个 lib 侧入口就是判别位）。",
    ).toBeDefined();
    /* 链首必须是那个 **lib 侧**入口：只断「目标被找到」的话，
     * 一条从 app 那侧绕过来的路也能把它满足掉，判别位就白设了。 */
    expect(hit?.chain[0]).toBe("src/lib/bar/tabs-entry.ts");
  });

  it("客户端图要能穿过 use client 边界（声明不是边界）", () => {
    // 真实树里的锚点（只读）：`src/trpc/react.tsx` 是 `"use client"`，而
    // `src/trpc/query-client.ts` **只**从它出发才可达。
    expect(readFileSync(join(SRC, "trpc", "react.tsx"), "utf8")).toMatch(/^\s*["']use client["']/m);

    const report = runScanOnFixture(CROSS_CLIENT_FIXTURE);
    const hit = report.clientReachable.find((h) => h.module === "src/trpc/pure-leaf.ts");
    expect(
      hit,
      '扫描器把 "use client" 当成了停止点：夹具里 src/trpc/pure-leaf.ts 只从 ' +
        'src/trpc/react-entry.ts（"use client"）可达，当边界就会漏报。' +
        " 一个永远把 clientReachable 返回空的实现也会红在这里 —— " +
        "这条断言要的正是一次真注入的图。",
    ).toBeDefined();
    expect(hit?.chain.join(" -> ")).toContain("src/trpc/react-entry.ts");
  });
});
