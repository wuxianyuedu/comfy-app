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
 *     情形（Next 请求上下文，无法下沉）。它**已按「消息/判决分离」消除**：
 *     `lib/auth-server.ts` 改为「会话 → 用户」的纯判决（会话由调用方传入），
 *     读会话的唯一落点搬到 `src/server/auth/request-user.ts`（`src/server/**`
 *     本来就是服务端物，不存在越界）。清单因此**归零**。
 *
 * 口径：源码串 + 目标文件路径。正则剥掉块注释，行注释只剥 `//` 开头的那一
 * 种，因此文件末尾的 `// from "~/server/lib/logger"` 这类说明**仍会被计入** ——
 * 对循环依赖检测（以源码串为输入）它就是同一条边，宁可多登记一条。
 *
 * **登记粒度是「边」，不是「源文件」**（这一点此前写错，等于门禁基本失效）：
 * `REGISTERED` 的键是源文件、值是目标文件，而判定曾写成 `!(e.from in REGISTERED)`
 * —— 只要一个文件因为**任何**理由进过一次清单，它此后新增的**任意** lib → server
 * 依赖都会被放行，且两条断言都不会红：新增边被当成「已登记」，`REGISTERED` 的值
 * 也没人比对。实测（`client.ts` 追加一个指向 `~/server/lib/brand-new` 的 import）
 * 三条用例全绿。现在比对的是 `from → to` 这一对，登记才真正等价于「这条边被裁决过」。
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

/**
 * 登记项：`lib` 侧文件 → `server` 侧目标。**只许变短**（见头注）。
 *
 * 这一批登记项曾含 11 个文件 → `src/server/lib/logger.ts`（`lib/comfyui/**` 与
 * `lib/drizzle-studio/lifecycle.ts`，外加 7 个测试文件的 `vi.mock` 说明符）。
 * 它们已全部消除：日志**实现**合并到 `src/lib/core/logger.ts`（`lib` 侧的中立出口
 * 本就存在），服务端侧 `src/server/lib/logger.ts` 降为转发层，`lib` 侧统一
 * `import { logger } from "~/lib/core/logger"` —— 方向由 `lib → server` 变回
 * `lib → lib`，不再是越界。
 *
 * 最后一条（better-auth 会话读取需 **Next 请求上下文**，无法下沉）也已消除，
 * 做法见 `src/server/auth/request-user.ts` 的头注：`lib` 侧只保留
 * 「会话 → 用户」的判决并把会话作为**入参**，读会话的落点搬到 `src/server/**`。
 *
 * 因此清单现在是**空的** —— 这正是本用例要守住的终态：`src/lib` 里任何一处
 * 新增的 `lib → server` 依赖都必须先裁决，而不是「反正有一条已登记」。
 */
const REGISTERED: Record<string, string> = {};

type Edge = { from: string; to: string };
/** 边的唯一标识。**必须带上目标**：只按源文件判「是否登记过」会把该文件此后
 *  新增的任意依赖一并放行（详见头注「登记粒度是边」）。 */
const key = (e: Edge) => `${e.from} -> ${e.to}`;

/** 已登记的边集合（由 `REGISTERED` 展开）。 */
const REGISTERED_EDGES = new Set(
  Object.entries(REGISTERED).map(([from, to]) => key({ from, to })),
);

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
    const unregistered = collectEdges().filter((e) => !REGISTERED_EDGES.has(key(e)));
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

  it("判定按「边」而非「源文件」：已登记文件新增别的 server 依赖必须被拦下", () => {
    // 这条用例是回归护栏本身：判定曾写成 `!(e.from in REGISTERED)`，于是
    // 「进过一次清单的文件」此后新增任意 lib → server 依赖都被放行。
    // 用纯数据复现那个谓词，锁住「新边必须算未登记」。
    // 合成一张登记表（与 REGISTERED 现状解耦：这条守的是**判定谓词**，
    // 不是清单内容），只用于复现「同一文件上新增的依赖必须算未登记」。
    const registered = new Map([
      ["src/lib/comfyui/client.ts", "src/server/lib/logger.ts"],
    ]);
    const registeredEdges = new Set(
      [...registered].map(([from, to]) => key({ from, to })),
    );
    const sample: Edge[] = [
      { from: "src/lib/comfyui/client.ts", to: "src/server/lib/logger.ts" }, // 已登记
      { from: "src/lib/comfyui/client.ts", to: "src/server/lib/brand-new.ts" }, // 未登记
    ];
    const unregistered = sample.filter((e) => !registeredEdges.has(key(e)));
    expect(
      unregistered.map(key),
      "同一源文件上新增的 server 依赖必须算「未登记」——否则清单一旦收录过某个文件，\n" +
        "它此后所有越界都会被静默放行（门禁形同不存在）。",
    ).toEqual(["src/lib/comfyui/client.ts -> src/server/lib/brand-new.ts"]);
  });

  it("扫描器本身有效：能识别真实依赖边，且不误伤同层引用（反向验证）", () => {
    // 清单归零之后，「当前清单为空」不再能证明扫描器在工作 —— 一个永远返回空
    // 的扫描器会让上面两条断言全绿。所以这里**注入一段与现状无关的源码**，
    // 直接验证 `stripComments` + `SPECIFIER_RE` + `resolveSpec` 这条链真的能
    // 从源码串解析到仓库内的 server 目标。
    const probe = `
      import { getSession } from "~/server/better-auth/server";
      // 曾经这样写：import { logger } from "~/server/lib/logger";
    `;
    const specs = [...stripComments(probe).matchAll(SPECIFIER_RE)].map((m) => m[1]);
    expect(specs, "解析器必须能认出 from 说明符").toEqual([
      "~/server/better-auth/server",
    ]);
    // 整行 `//` 注释被剥掉（否则说明性路径会被误判成依赖）
    expect(specs).not.toContain("~/server/lib/logger");
    // 说明符能解析到仓库内的真实文件（不是「永远返回 null」）
    expect(resolveSpec("~/server/better-auth/server")).toBe(
      "src/server/better-auth/server.ts",
    );
    // 数据层同层引用（`lib/core/**` → `~/server/db/schema`）被 SERVER_OWNED_RE 排除，
    // 不入清单 —— 这条守的是「判据不是一律禁止」
    expect(SERVER_OWNED_RE.test("src/server/db/schema.ts")).toBe(false);
    expect(SERVER_OWNED_RE.test("src/server/better-auth/server.ts")).toBe(true);

    // 现实面：那条越界边确实已经不存在了
    const live = new Set(collectEdges().map(key));
    expect(live.has("src/lib/auth-server.ts -> src/server/better-auth/server.ts")).toBe(false);
    // 日志方向已归位：`lib` 侧不再依赖 server 的日志实现（实现合并到 lib 侧）
    expect(live.has("src/lib/comfyui/client.ts -> src/server/lib/logger.ts")).toBe(false);
    // 数据层（`lib/core` / `lib/db`）取 Drizzle 表定义属同层引用，不入本清单
    expect(live.has("src/lib/core/repository-task.ts -> src/server/db/schema.ts")).toBe(false);
  });
});
