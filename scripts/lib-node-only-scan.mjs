#!/usr/bin/env node
/**
 * lib-node-only-scan.mjs — `src/lib/**` 的 Node-only 声明可达性分析（规范 §18.4）。
 *
 * 为什么必须有这个脚本，而不是「扫到 import fs 就要求 server-only」：
 * 那种写法**没有任何门禁能替它兜底**。实测 `eslint-plugin-boundaries` 的 import
 * 图对服务端源码**完全不采样**（给 `src/lib/log-paths.ts` 加
 * `import "server-only"` 后 `pnpm lint` 仍绿），也就是说「扫文本」的判据一旦写歪
 * 就永远是绿的。而两类**真问题**都只有依赖图能回答：
 *
 *   1. **假声明**：模块写着「只能服务端用」，实际仍被纯模块引到 ——
 *      声明没生效，出事时没人会怀疑它（`log-session-scope` 的形态）。
 *   2. **真进浏览器图**：纯模块被 `"use client"` 入口引到，而顶层有 Node 内建
 *      —— Turbopack 报 `does not support external modules`，**整页 500**
 *      （ISSUE #317 / #282）。这条与 `tests/client-bundle-node-builtins.test.ts`
 *      同源；那边的入口是「所有 use client 文件」，这里的入口**多一个
 *      `src/lib` 自身**，覆盖「视图层还没接上、lib 内部先串起来」的中间态。
 *
 * 用法：
 *   node scripts/lib-node-only-scan.mjs            # 人读报告
 *   node scripts/lib-node-only-scan.mjs --json     # 机器读（供契约测试）
 *   node scripts/lib-node-only-scan.mjs --strict   # 有发现即非零退出（CI）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/** Node 内建模块名（评测口径与 `tests/client-bundle-node-builtins.test.ts` 一致）。 */
const NODE_BUILTINS =
  /^(node:)?(fs|fs\/promises|path|child_process|os|url|module|crypto|stream|util|events|net|tls|http|https|zlib|worker_threads|perf_hooks|readline|assert|dns|querystring|string_decoder|tty|v8|vm)$/;

/** 第二类声明后缀（§18.4）：同一领域的服务端拆件。 */
const SERVER_SUFFIX = ".server.ts";

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 抽出模块的 import 列表（值导入与 type-only 分开标注）。 */
function parseImports(src) {
  const out = [];
  const fromRe = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = fromRe.exec(src))) {
    out.push({ clause: m[1].replace(/\s+/g, " ").trim(), spec: m[2] });
  }
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  while ((m = bareRe.exec(src))) out.push({ clause: "", spec: m[1] });
  return out;
}

function resolveLocal(fromFile, spec) {
  let base;
  if (spec.startsWith("~/") || spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function listModules(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      listModules(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/* 判据只管 **逻辑层** `src/lib/**`（§18 的适用范围）。
 *
 * 为什么不把 `src/app/api/**` 与 `src/server/**` 也算进来：它们**本来就**是
 * 服务端物，顶层 `import fs` 是这个位置的定义（route 里读写文件、server 侧
 * 进程编排）。给它们逐个加 `server-only` 只是把「本来就是」写成一行仪式文字，
 * 而**仪式化的声明会稀释真的那个**：当每个文件都带这行时，`log-session-scope`
 * 恰好漏掉的那次没人会看出来。这里刻意只对中国 lib 判 —— 与
 * `tests/client-bundle-node-builtins.test.ts` 的既有口径一致。 */
const IN_SCOPE = (file) => rel(file).startsWith("src/lib/");

/** 模块自带的声明形态（§18.4 的三分类）。 */
function declarationOf(file, raw) {
  if (/^\s*import\s+["']server-only["']/m.test(raw)) return "server-only";
  if (rel(file).endsWith(SERVER_SUFFIX)) return "server-suffix";
  if (/^\s*["']use client["']/m.test(raw)) return "use-client";
  return "none";
}

function analyze() {
  const files = listModules(SRC);
  const decls = new Map();
  const nodeImports = new Set();
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const src = stripComments(raw);
    const decl = declarationOf(file, raw);
    decls.set(file, decl);
    const hasNode = parseImports(src).some(
      (im) => !/^type\s/.test(im.clause) && NODE_BUILTINS.test(im.spec),
    );
    if (hasNode) nodeImports.add(file);
  }

  /* 边界判据：模块**自己**声明了「只用我」时，从它继续向下走会把整个服务端图
   * 都算成命中（服务端代码引服务端代码是正常的）。所以边界处必须停。
   *
   * 关键在于**哪些声明算边界**，两条入口的答案不同：
   *   · `server-only` / `.server.ts` 是**真边界** —— 它们的后面是服务端世界。
   *   · `"use client"` 不是边界，它是**同一个客户端图里的另一个节点**：
   *     client component 引 client component 是常态，从 `"use client"` 模块
   *     继续往下走才看得见「客户端图里到底有没有 Node-only 物」。
   *     （实测：`src/trpc/react.tsx` 是 `"use client"`，而只有一个未声明的
   *     `src/trpc/query-client.ts` 从它出发才可达 —— 把它当边界，这个模块
   *     就永远不在客户端可达集里，判据静默失效。） */
  const isServerBoundary = (file) => {
    const d = decls.get(file);
    return d === "server-only" || d === "server-suffix";
  };

  /** 从一组入口出发，找到「先撞上谁」。带分支，用于给出完整引用链。 */
  function reach(entries, isTarget) {
    const seen = new Set();
    const hits = new Map();
    const walk = (file, chain) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (isTarget(file, chain)) {
        hits.set(rel(file), [...chain, rel(file)]);
        return;
      }
      /* 顺序不能反：先判边界再往下走，否则目标永远不可达、判据静默变成「永远为 0」。 */
      if (isServerBoundary(file) && chain.length > 0) return;
      const src = stripComments(fs.readFileSync(file, "utf8"));
      for (const im of parseImports(src)) {
        if (/^type\s/.test(im.clause)) continue;
        const next = resolveLocal(file, im.spec);
        if (next) walk(next, [...chain, rel(file)]);
      }
    };
    for (const e of entries) walk(e, []);
    return [...hits.entries()].map(([module, chain]) => ({ module, chain }));
  }

  /* ── 入口 A：lib 侧的**网络客户端**（§17.2 第②层，会被客户端组件引） ──
   *
   * 为什么不拿「所有未声明的 lib 模块」当入口：那会把服务端执行链
   * （`comfyui/enqueue` → `reaper` → …）也当成入口 —— 它们是服务端图里的模块，
   * 引到 `server-only` 物是正常的，只有**客户端可能引到的**那条路径才该判。
   * 判据因此是「契约语义」而不是目录名：被 `"use client"` 组件静态引到的
   * lib 模块，就是那条路径的起点。 */
  const clientDeclared = new Set(
    files.filter((f) => decls.get(f) === "use-client").map((f) => f),
  );
  const clientReachablePure = new Set();
  {
    const seenEntry = new Set();
    const walkEntry = (file, isRoot) => {
      if (seenEntry.has(file)) return;
      seenEntry.add(file);
      // 入口自身是客户端组件，但它**是**那条路径的起点；从它的依赖开始才算「被引到」。
      if (!isRoot) clientReachablePure.add(file);
      // 服务端边界之后不属于客户端图；`"use client"` 不在此列（它是同一张图里的
      // 另一个节点，从它继续走才拿得到完整的客户端可达集，见 `isServerBoundary`）。
      if (isServerBoundary(file) && !isRoot) return;
      const src = stripComments(fs.readFileSync(file, "utf8"));
      for (const im of parseImports(src)) {
        if (/^type\s/.test(im.clause)) continue;
        const next = resolveLocal(file, im.spec);
        if (next) walkEntry(next, false);
      }
    };
    for (const e of clientDeclared) walkEntry(e, true);
  }
  const libEntries = files.filter(
    (f) => rel(f).startsWith("src/lib/") && decls.get(f) === "none" && clientReachablePure.has(f),
  );
  /* 服务的归属由模块**自己**回答：没人声明「只能用我」的模块就是普通逻辑模块，
   * 它引到声明过的模块 = 声明没生效（这才叫假声明）。
   * 声明过的模块之间互相引是正常的（服务端代码引服务端代码），
   * 因此**不从声明过的模块继续往下走** —— 否则会把整个服务端图都算成命中。 */
  const isPureModuleEntry = (file) => decls.get(file) === "none";
  const libOnlyReachable = reach(
    libEntries,
    (file) => decls.get(file) === "server-only" || decls.get(file) === "server-suffix",
  );

  // ── 入口 B：`"use client"` 入口（真会被打进浏览器图的那条） ───────────
  const clientEntries = files.filter((f) => decls.get(f) === "use-client");
  const clientReachable = reach(
    clientEntries,
    (file) => nodeImports.has(file) && !/^src\/(server|api)\//.test(rel(file)),
  );

  const unguarded = [...nodeImports]
    .filter((f) => decls.get(f) === "none" && IN_SCOPE(f))
    .map(rel)
    .sort();

  return {
    unguarded,
    libOnlyReachable,
    clientReachable,
    counts: {
      modules: files.length,
      inScope: files.filter(IN_SCOPE).length,
      nodeImports: nodeImports.size,
      guardedServerOnly: [...decls.values()].filter((d) => d === "server-only").length,
      guardedServerSuffix: [...decls.values()].filter((d) => d === "server-suffix").length,
    },
  };
}

const report = analyze();
const asJson = process.argv.includes("--json");
if (asJson) {
  process.stdout.write(JSON.stringify(report));
} else {
  const lines = [
    `扫描 ${report.counts.modules} 个模块：顶层 import Node 内建 ${report.counts.nodeImports} 个` +
      `（server-only ${report.counts.guardedServerOnly} / .server.ts ${report.counts.guardedServerSuffix}）`,
    "",
    `未声明（§18.4 三选一，应为 0 或已登记）：${report.unguarded.length}`,
    ...report.unguarded.map((f) => `  · ${f}`),
    "",
    `声明失效（写着只能服务端用，却仍被纯模块引到）：${report.libOnlyReachable.length}`,
    ...report.libOnlyReachable.map((h) => `  · ${h.module}\n      ${h.chain.join(" -> ")}`),
    "",
    `客户端可达的 Node-only 模块：${report.clientReachable.length}`,
    ...report.clientReachable.map((h) => `  · ${h.module}\n      ${h.chain.join(" -> ")}`),
  ];
  console.log(lines.join("\n"));
}

const strict = process.argv.includes("--strict");
if (strict && (report.libOnlyReachable.length > 0 || report.clientReachable.length > 0)) {
  process.exit(1);
}
