/**
 * `lib` 与 `server` 的跨层依赖**逐个登记**（ISSUE #569 第 6 项 / 规范 §18.10）。
 *
 * 背景（实测）：`eslint-plugin-boundaries` 声明 `src/lib/**` 为 element `lib`
 * 之后，「lib 不得 import components」由机器拦住，**但「lib 不得 import server」
 * 这条没写** —— 于是 `lib/comfyui/**` 与 `lib/drizzle-studio/` 里 11 个文件
 * 直接 `from "~/server/lib/logger"`，而 `pnpm lint` 全绿，只能靠人读代码发现。
 *
 * 为什么不是「一律禁止」：`lib` 与 `server` 之间**本来就有两类合法方向**，一律
 * 禁止会把它们一起误伤（那不是判据，那是噪音）：
 *
 *   ① `src/lib/core/**`、`src/lib/db.ts` 是**数据层**（`eslint.config.js` 把
 *      `src/lib/core/**`、`src/lib/db/**` 显式声明为 element `server`；元素顺序
 *      是语义，见 `tests/lib-layer-boundaries.test.ts`）。它们 import
 *      `~/server/db/schema` 取 Drizzle 表定义是**同层**引用，不是越界。
 *   ② 测试文件里的 `vi.mock("~/server/lib/logger")` 说明符必须与源码串一致才能
 *      生效，源码改写时它自然跟着改；单独断言只会制造与源码脱节的门。
 *
 * 所以本用例守的是**第三条**：越界依赖必须**逐个登记**，清单只许变短。
 * 这是 ISSUE #569 第 6 项「决策并落地」的具体形式 —— 不允许再出现「新的 lib
 * 模块悄悄依赖 server」而没有任何判据拦它。
 *
 * 登记项（全部指向同一件事 + 同一后续动作）：
 *   · 目标 `src/server/lib/logger.ts` 的价值已被实测证明：`lib/core/logger.ts`
 *     是它的薄封装（接口逐字一致、调用方零改动），且 `core/logger.ts` 不带
 *     `server-only`（规范 §18.4 第三类：核心层被纯 Node 宿主与 Next 同时加载）。
 *     ⇒ 消除这批依赖 = 把 `server/lib/logger` 的实现在两个**同层**模块之间
 *       合并/下沉（`lib/core/logger` ⇄ `server/lib/logger`），新增已无事可做。
 *   · 目标 `src/server/better-auth/server.ts`（`lib/auth-server.ts`）属另一种
 *     情形（Next 请求上下文，无法下沉），留待专项裁决。
 *
 * 口径：源码串 + 目标文件路径。正则剥掉块注释，行注释只剥 `//` 开头的那一
 * 种，因此文件末尾的 `// from "~/server/lib/logger"` 这类说明**仍会被计入** ——
 * 对循环依赖检测（以源码串为输入）它就是同一条边，宁可多登记一条。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 模块说明符提取：`from "x"`、`import("x")`、`require("x")`、`vi.mock("x")`。 */
const SPECIFIER_RE = /(?:from|import|require|vi\.mock)\s*\(?\s*["']([^"']+)["']/g;

/** 把说明符解析到仓库内的实际文件（只处理本仓库的 `~/` 与 `@/` 别名）。 */
function resolveSpec(spec: string): string | null {
  const m = /^(?:~|@)\/(.+)$/.exec(spec);
  if (!m?.[1]) return null;
  const base = join(ROOT, "src", m[1]);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return relative(ROOT, candidate).split("\\").join("/");
    } catch {
      /* 不存在就试下一个形态 */
    }
  }
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** 去掉块注释与「整行以 // 开头」的行注释，避免把说明性路径误判成依赖。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** 目标侧：真正的「服务端领域」文件（`lib/core`、`lib/db` 是数据层成员，见头注 ①）。 */
const SERVER_OWNED_RE = /^src\/server\/(?!db\/schema\.ts|db\.ts)/;

/** 登记项：`lib` 侧文件 → `server` 侧目标。只许变短（见头注）。 */
const REGISTERED: Record<string, string> = {
  "src/lib/auth-server.ts": "src/server/better-auth/server.ts",
  "src/lib/comfyui/cli-procs-singleton.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/client.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/executor-scheduler.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/lifecycle.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/reaper-decisions.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/reaper.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/status.test.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/client.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/executor-continuation.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/executor-scheduler.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/executor-ws.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/importSource.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/lifecycle.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/reaper.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/status.ts": "src/server/lib/logger.ts",
  "src/lib/comfyui/workflow-subgraph-parse.ts": "src/server/lib/logger.ts",
  "src/lib/core/logger.ts": "src/server/lib/logger.ts",
  "src/lib/drizzle-studio/lifecycle.ts": "src/server/lib/logger.ts",
};

type Edge = { from: string; to: string };
const key = (e: Edge) => `${e.from} -> ${e.to}`;

function collectEdges(): Edge[] {
  const edges = new Map<string, Edge>();
  for (const file of walk(join(ROOT, "src", "lib"))) {
    const rel = relative(ROOT, file).split("\\").join("/");
    const src = stripComments(readFileSync(file, "utf8"));
    for (const match of src.matchAll(SPECIFIER_RE)) {
      const spec = match[1];
      if (typeof spec !== "string") continue;
      const target = resolveSpec(spec);
      if (!target?.startsWith("src/server/")) continue;
      if (!SERVER_OWNED_RE.test(target) && !(rel in REGISTERED)) continue;
      const edge = { from: rel, to: target };
      edges.set(key(edge), edge);
    }
  }
  return [...edges.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

describe("lib → server 的越界依赖逐个登记，清单只许变短（ISSUE #569 第 6 项）", () => {
  it("没有未登记的 lib → server 依赖", () => {
    const unregistered = collectEdges().filter((e) => !(e.from in REGISTERED));
    const report = unregistered.map((e) => `  ✗ ${e.from}\n      → ${e.to}`).join("\n");
    expect(
      unregistered,
      "src/lib 是被 server / components / app 共同依赖的地基，新增对 src/server/** 的依赖必须先裁决并登记。\n" +
        "需要日志：改走中立出口 `@/lib/core/logger`（pino 的薄封装，接口一致，实现仍只有一份）；\n" +
        "需要别的服务端能力：把被依赖的部分下沉到 lib，或由调用方注入（规范 §12.7 依赖倒置）。\n" +
        report,
    ).toEqual([]);
  });

  it("登记清单没有失效项（依赖已消除的条目必须删掉，棘轮只许变短）", () => {
    const live = new Set(collectEdges().map(key));
    const stale = Object.entries(REGISTERED)
      .filter(([from, to]) => !live.has(key({ from, to })))
      .map(([from, to]) => `  ✗ ${from} -> ${to}`);
    expect(
      stale,
      "以下登记项已不再成立（依赖被消除或目标文件被移动），请从 REGISTERED 中删除：\n" +
        stale.join("\n"),
    ).toEqual([]);
  });

  it("扫描器本身有效：能识别登记项里的真实依赖边（反向验证）", () => {
    const live = new Set(collectEdges().map(key));
    // 取一条必然存在的既有边，确认解析逻辑不是「永远返回空」
    expect(live.has("src/lib/comfyui/client.ts -> src/server/lib/logger.ts")).toBe(true);
    // 数据层（`lib/core` / `lib/db`）取 Drizzle 表定义属同层引用，不入本清单
    expect(live.has("src/lib/core/repository-task.ts -> src/server/db/schema.ts")).toBe(false);
  });
});
