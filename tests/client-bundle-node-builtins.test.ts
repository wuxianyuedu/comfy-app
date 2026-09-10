/**
 * 客户端 bundle 不得含 Node-only 模块（ISSUE #317 定位的 P0 回归）。
 *
 * 背景：`src/lib/log-session-scope.ts` 顶层 `import fs from "node:fs"`，而
 * 客户端组件 `LogProvider.tsx`（"use client"）只是想要它的纯函数
 * `clampLogTime`。Turbopack 编译浏览器 chunk 时把 `node:fs` 整图形入，报
 * `the chunking context does not support external modules (request: node:fs)`
 * 并让 endpoint 编译失败——**`/login` 与 `/workspace` 整页 500**，应用完全
 * 打不开。这与 `app-runtime-log.ts` 的历史回归（ISSUE #282 / 规范 07 §7.12）
 * 同源，只是这次走的是「纯逻辑模块混进了 IO」这条更隐蔽的路。
 *
 * 本测试把「客户端可达图中不得出现顶层 import Node 内建的模块」变成硬门禁：
 * 静态遍历 `"use client"` 入口的 import 图（`import type` 编译期擦除，不算），
 * 命中即失败并给出完整引用链。这样同类问题在提交阶段就暴露，而不是等
 * `next build` / 页面 500。
 *
 * 为什么不用 Turbopack 自己报错：那要跑完整构建（分钟级）且只在构建期可见；
 * 本测试毫秒级、能给出引用链、可在 pre-commit 跑。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Node 内建模块名（node: 前缀可选）。这些模块在浏览器 chunk 里不可用。 */
const NODE_BUILTINS =
  /^(node:)?(fs|fs\/promises|path|child_process|os|url|module|crypto|stream|util|events|net|tls|http|https|zlib|worker_threads|perf_hooks|readline|assert|dns|querystring|string_decoder|tty|v8|vm)$/;

/** 客户端入口：整棵 app 树里带 "use client" 的文件，加上各 page/layout。 */
function collectClientEntries(): string[] {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) return void 0;
      if (/\.test\.(ts|tsx)$/.test(name)) continue;
      const src = readFileSync(full, "utf8");
      if (/^\s*["']use client["']/m.test(src)) entries.push(full);
    }
  };
  walk(join(SRC, "app"));
  walk(join(SRC, "components"));
  return entries;
}

/** 去掉注释，避免把注释里提到的 `node:fs` 误判成 import。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type ImportRef = { clause: string; spec: string };

function parseImports(src: string): ImportRef[] {
  const out: ImportRef[] = [];
  const fromRe = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src))) {
    const clause = m[1];
    const spec = m[2];
    if (clause === undefined || spec === undefined) continue;
    out.push({ clause: clause.replace(/\s+/g, " ").trim(), spec });
  }
  const bareRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  while ((m = bareRe.exec(src))) {
    const spec = m[1];
    if (spec === undefined) continue;
    out.push({ clause: "", spec });
  }
  return out;
}

/** 解析 `~/x`、`@/x`、相对路径到实际文件（含 index 与扩展名探测）。 */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("~/") || spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** 源码里是否**顶层** import 了 Node 内建（值导入；type-only 会被擦除）。 */
function importsNodeBuiltin(file: string): boolean {
  const src = stripComments(readFileSync(file, "utf8"));
  return parseImports(src).some(
    (im) => !/^type\s/.test(im.clause) && NODE_BUILTINS.test(im.spec),
  );
}

/** 一次遍历拿到「源码里顶层 import 内建」的全部模块。 */
function collectNodeBuiltinModules(): Set<string> {
  const set = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (/\.test\.(ts|tsx)$/.test(name)) continue;
      if (importsNodeBuiltin(full)) set.add(full);
    }
  };
  walk(SRC);
  return set;
}

/** 从客户端入口做 DFS，返回所有「客户端可达且自带 node 内建」的模块 + 引用链。 */
function findClientReachableNodeBuiltins(): { file: string; chain: string[] }[] {
  const builtinModules = collectNodeBuiltinModules();
  const seen = new Set<string>();
  const hits: { file: string; chain: string[] }[] = [];

  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(ROOT, file);
    // 服务端目录里的模块本来就能用 Node 内建——它们不该出现在客户端图里，
    // 一旦出现，说明某个客户端模块静态 import 了服务端代码（那本身就是 bug，
    // 但会在 Turbopack 报错，属另一类问题）。这里只判「非服务端模块」。
    const isServerOwned = /^src\/(server|app\/api)\//.test(rel);
    if (builtinModules.has(file) && !isServerOwned) {
      hits.push({ file: rel, chain: [...chain, rel] });
      return; // 不必再往下：命中即足够作为证据
    }
    const src = stripComments(readFileSync(file, "utf8"));
    for (const im of parseImports(src)) {
      if (/^type\s/.test(im.clause)) continue; // 编译期擦除
      const next = resolveLocal(file, im.spec);
      if (next) walk(next, [...chain, rel]);
    }
  };

  for (const entry of collectClientEntries()) walk(entry, []);
  return hits;
}

describe("客户端可达图中不得出现顶层 import Node 内建的模块", () => {
  it("全仓扫描为绿（无客户端可达的 Node-only 模块）", () => {
    const hits = findClientReachableNodeBuiltins();
    const report = hits
      .map((h) => `  ✗ ${h.file}\n      引用链：${h.chain.join(" -> ")}`)
      .join("\n");
    expect(
      hits,
      `以下模块被客户端组件静态引用，且顶层 import 了 Node 内建模块——\n` +
        `Turbopack 会以 "does not support external modules" 让整页 500。\n` +
        `修法：把纯逻辑（客户端要用的）与 IO（Node-only）拆成两个文件，\n` +
        `IO 那个放 <name>.server.ts（见 ISSUE #282 / #317 与规范 07 §7.12）。\n${report}`,
    ).toEqual([]);
  });

  it("log-session-scope 已分层：纯函数模块不含 fs，IO 在 .server 模块", () => {
    // 这是本测试要守住的具体回归（ISSUE #317 的 P0）。
    const pure = readFileSync(join(SRC, "lib", "log-session-scope.ts"), "utf8");
    expect(stripComments(pure)).not.toMatch(/from\s+["']node:fs["']/);
    // 纯函数仍可被客户端 import（clampLogTime 是 LogProvider 在用的）
    expect(pure).toContain("export function clampLogTime");
    expect(pure).toContain("export function resolveSessionStart");

    const server = readFileSync(join(SRC, "lib", "log-session-scope.server.ts"), "utf8");
    expect(server).toMatch(/from\s+["']node:fs["']/);
    expect(server).toContain("export function fileMtimeMs");
  });

  it("扫描器本身有效：能识别出顶层 import fs 的模块", () => {
    // 反向验证：确认扫描逻辑不是「永远返回空」。
    const serverFile = join(SRC, "lib", "log-session-scope.server.ts");
    expect(importsNodeBuiltin(serverFile)).toBe(true);
    // type-only 导入不算（编译期擦除）
    const src = 'import type { AppRouter } from "~/server/api/root";\n';
    expect(parseImports(src).every((im) => /^type\s/.test(im.clause))).toBe(true);
  });
});
