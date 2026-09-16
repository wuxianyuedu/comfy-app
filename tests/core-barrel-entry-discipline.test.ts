/**
 * 回归护栏：`src/lib/core/index.ts` 的出口纪律（ISSUE #565）。
 *
 * 背景（实测）：这里曾是四个 `export *` 转发的 barrel，注释里写着「所有 server
 * 端模块统一 `import { ... } from "@/lib/core"`」—— 而全库只有 2 处真的这样
 * 导入。这条注释是**一条假承诺**：实际口径是深路径（`@/lib/core/repository` 等），
 * 照着注释写的人只会再多出一种取法（与已删除的 `container` 同款教训）。
 *
 * 本用例把「出口纪律」机器化，三条判据各自对应一个具体后果：
 *
 *   1. **不许 `export *`**：它让每个引用方都强制加载整层（pino + zod + Drizzle 表
 *      定义 + `server-only`），并把「谁依赖了哪一份」藏起来；
 *   2. **每个被转出的符号必须有消费方**：没有消费方的转发就是「零消费导出」
 *      （规范 §12.16 / `scripts/check-dead-exports.cjs` 的同一口径）；
 *   3. **同层环不得靠「没人这么写」维持**：`core/logger` → `lib/app-runtime-log`
 *      → `lib/log-paths`（同层），而 `log-paths` 若从本 barrel 取用就会形成
 *      `index → logger → … → index`。环检测只认真实存在的边，所以此前不报红 ——
 *      本用例直接断言该反例为环，锁住「为什么这里不许 `export *`」这个理由。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const INDEX = join(ROOT, "src", "lib", "core", "index.ts");

/** 去掉块注释与整行 `//` 注释，避免把注释里的示例当真实语句。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("core/index.ts 的出口纪律（ISSUE #565）", () => {
  it("不做 `export *` 转发", () => {
    const code = stripComments(readFileSync(INDEX, "utf8"));
    expect(
      code.match(/export\s+\*/g),
      "`export *` 会把整层的加载代价与依赖关系一并转给引用方，且让「谁依赖了哪一份」不可见。\n" +
        '新增转出请用具名 `export { x } from "./y"`，并同时给出消费方。',
    ).toBeNull();
  });

  it("转出的每个符号都有消费方（没有消费方的转发等于零消费导出）", () => {
    const code = stripComments(readFileSync(INDEX, "utf8"));
    const names = [...code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)]
      .flatMap((m) => (m[1] ?? "").split(","))
      .map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      )
      .filter((n): n is string => Boolean(n));
    // 正向：当前唯一转出的符号是确实被引用的那个（反向验证扫描器不是空转）
    expect(names).toContain("SkillSeed");

    // 反向：扫全仓（含测试 / 脚本），每个转出的符号必须至少有一处引用。
    const corpus = ["src", "tests", "scripts", "e2e"]
      .flatMap((dir) => walkAll(join(ROOT, dir)))
      .filter((f) => f !== INDEX)
      .map((f) => stripComments(readFileSync(f, "utf8")))
      .join("\n");
    const orphaned = names.filter(
      (n) => !new RegExp(`\\b${n}\\b`).test(corpus),
    );
    expect(
      orphaned,
      "以下符号被 `core/index.ts` 转出但全仓无人引用 —— 转发它只会制造一条「看起来有用」的出口：\n" +
        "要么给它接上消费方，要么从 barrel 里删掉（规范 §12.16）。",
    ).toEqual([]);
  });

  it("barrel 与「同层模块从它取用」组合起来不产生环（判据保留在这里的理由）", () => {
    // 这条不是「测代码」，而是把 `export *` 判据的**理由**钉成可执行事实：
    // 若 barrel 重新 `export * ./logger`，而 `lib/log-paths.ts` 又从这里取用，
    // 就会出现 index → logger → app-runtime-log → log-paths → index。
    // 环检测（scripts/check-circular-deps.cjs）只认真实存在的边，抓不到这种
    // 「一写就成环」的潜在组合 —— 所以这里用一个合成图复现它，锁住结论。
    const graph = new Map([
      ["src/lib/core/index.ts", ["src/lib/core/logger.ts"]],
      ["src/lib/core/logger.ts", ["src/lib/app-runtime-log.ts"]],
      ["src/lib/app-runtime-log.ts", ["src/lib/log-paths.ts"]],
      ["src/lib/log-paths.ts", ["src/lib/core/index.ts"]],
    ]);
    expect(
      hasCycle(graph),
      "barrel 转出 logger + 同层模块从 barrel 取用 = 一个靠「没人这么写」才不成立的环。",
    ).toBe(true);

    // 反向：barrel 只转出**不回头依赖本 barrel** 的类型模块时，同一张图无环。
    const safe = new Map(graph);
    safe.set("src/lib/core/index.ts", ["src/lib/core/repository-skill.ts"]);
    safe.set("src/lib/core/repository-skill.ts", []);
    expect(hasCycle(safe)).toBe(false);
  });
});

/** 递归列出目录下的源码文件（文档与产物不参与）。 */
function walkAll(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === ".git")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else if (/\.(ts|tsx|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** 有向图环检测（DFS + 递归栈）。 */
function hasCycle(graph: Map<string, string[]>): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (node: string): boolean => {
    if (state.get(node) === 1) return true;
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const node of graph.keys()) if (visit(node)) return true;
  return false;
}
