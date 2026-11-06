/**
 * 回归护栏：`src/lib/core/index.ts` 的出口纪律（ISSUE #565）。这曾是四个 `export *` 的 barrel，注释里写着「统一从
 * `@/lib/core` 导入」而全库只有 2 处照做 —— 假承诺，照写只会多出一种取法。三条机器判据：不许 `export *`（强制整层
 * 加载、藏起依赖）、被转出符号必须有消费方（§12.16 / `check-dead-exports.cjs`）、`log-paths` 那条同层环必须仍判为环。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* 扫描面上的「列到名字、读时已没」由这一层地基统一回答（`tests/gate-scan-read.test.ts`
 * 是它自己的判据）：`tests/` 下那些自造自删的并发探针（`.setup-cleanup-probe-*.test.tsx`）
 * 与本用例同时活动，CI 上撞出来的是一条不含本判据、也不含真凶的 `ENOENT` 栈。 */
const requireCjs = createRequire(import.meta.url);
/* SAFETY: 类型断言已复核 */
const reader = requireCjs("../scripts/gate-scan-read.cjs") as {
  dirExists: (dir: string) => boolean;
  readForScan: (abs: string) => string | null;
  vanishedNote: (count: number) => string;
  walkForScan: (dir: string, fileRe: RegExp, opts?: { skipDirs?: Set<string> }) => Array<string>;
};

const ROOT = process.cwd();
const INDEX = join(ROOT, "src", "lib", "core", "index.ts");

/** 去掉块注释与整行 `//` 注释，避免把注释里的示例当真实语句。 */
function stripComments(src: string): string {
  return src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
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

  // 全仓 walk + stripComments 的判据：并行跑多份工程时 5s 默认超时会假红
  // （单独跑 <3s）。给足容忍度，断言本身不变。
  it("转出的每个符号都有消费方（没有消费方的转发等于零消费导出）", { timeout: 30_000 }, () => {
    const code = stripComments(readFileSync(INDEX, "utf8"));
    const names = [...code.matchAll(/export\s+(?:type\s+)?\{(?<names>[^}]*)\}/g)]
      .flatMap((m) => (m.groups?.names ?? "").split(","))
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
    const roots = ["src", "tests", "scripts", "e2e"].map((d) => join(ROOT, d));
    /* 「根不在」与「条目消失」是两回事（`gate-scan-read` 那条口径）：一份都没读到
     * 却报绿，比崩掉更坏。老写法把 `readdirSync` 的 ENOENT 一并吞成空数组，
     * 于是重命名一个顶层目录就能让本用例静默失去覆盖面。 */
    const missingRoots = roots.filter((r) => !reader.dirExists(r));
    expect(
      missingRoots,
      `扫描根缺失 ⇒ 这一轮的语料是残缺的，「无人引用」这个结论没有依据：${missingRoots.join(", ")}`,
    ).toEqual([]);
    let vanished = 0;
    const corpus = roots
      .flatMap((dir) => walkAll(dir))
      .filter((f) => f !== INDEX)
      .map((f) => {
        /* 消失 ⇒ 这一轮没读到，计入读数而不是崩掉整条判据（读不到 ≠ 没有违规，
         * 但「列到名字、读时已没」的那一份内容里也不可能藏着引用）。 */
        const text = reader.readForScan(f);
        if (text === null) {
          vanished += 1;
          return "";
        }
        return stripComments(text);
      })
      .join("\n");
    if (vanished > 0) {
      /* 静默跳过等于让本用例在它其实没读过的文件上假装绿 —— 读数要出来。
       * 打印排在断言之前：断言失败时 vitest 会把这一段一起带出去。 */
      console.info(`[core-barrel]${reader.vanishedNote(vanished).trim()}`);
    }
    const orphaned = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(corpus));
    expect(
      orphaned,
      `以下符号被 \`core/index.ts\` 转出但全仓无人引用 —— 转发它只会制造一条「看起来有用」的出口：\n` +
        `要么给它接上消费方，要么从 barrel 里删掉（规范 §12.16）。${reader.vanishedNote(vanished)}`,
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

/** 递归列出目录下的源码文件（文档与产物不参与）。遍历走 `scripts/gate-scan-read.cjs` 的地基（AGENTS 硬规则 24），
 * 不再自己 `readdirSync` + `statSync`：后者在「列到名字 → 取类型」之间有消失窗口，CI 上崩的正是那一跳的读取
 * （枚举这一跳同形）；本仓已有唯一实现，留第二份削弱版只会让下一次竞态换个栈再崩。 */
function walkAll(dir: string): Array<string> {
  return reader.walkForScan(dir, /\.(?:ts|tsx|mjs|cjs)$/, {
    skipDirs: new Set([".git", ".next", "node_modules"]),
  });
}

/** 有向图环检测（DFS + 递归栈）。 */
function hasCycle(graph: Map<string, Array<string>>): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (node: string): boolean => {
    if (state.get(node) === 1) {
      return true;
    }
    if (state.get(node) === 2) {
      return false;
    }
    state.set(node, 1);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    state.set(node, 2);
    return false;
  };
  for (const node of graph.keys()) {
    if (visit(node)) {
      return true;
    }
  }
  return false;
}
