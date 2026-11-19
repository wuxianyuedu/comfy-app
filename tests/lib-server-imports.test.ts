/**
 * `lib` 与 `server` 的跨层依赖**逐个登记**（ISSUE #569 第 6 项 / 规范 §18.9）：`eslint-plugin-boundaries` 只拦住
 * 「lib 不得 import components」，「lib 不得 import server」没写，于是 11 个文件直连 `~/server/lib/logger` 而 `pnpm lint`
 * 全绿。不一律禁止：`src/lib/core/**`、`src/lib/db.ts` 被声明为 element `server`（同层引用）。登记粒度是**边**不是
 * 源文件（旧写法 `!(e.from in REGISTERED)` 会放行此后任意新边，实测三例全绿）；清单只许变短，口径为源码串 + 目标路径。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 模块说明符提取：`from "x"`、`import("x")`、`require("x")`、`vi.mock("x")`。 */
const SPECIFIER_RE = /(?:from|import|require|vi\.mock)\s*\(?\s*["'](?<spec>[^"']+)["']/g;

/** 把说明符解析到仓库内的实际文件（只处理本仓库的 `~/` 与 `@/` 别名）。 */
function resolveSpec(spec: string): string | null {
  const m = /^(?:~|@)\/(?<inner>.+)$/.exec(spec);
  const inner = m?.groups?.inner;
  if (inner === undefined || inner === "") {
    return null;
  }
  const base = join(ROOT, "src", inner);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) {
        return relative(ROOT, candidate).split("\\").join("/");
      }
    } catch {
      /* 不存在就试下一个形态 */
    }
  }
  return null;
}

function walk(dir: string, out: Array<string> = []): Array<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉块注释与「整行以 // 开头」的行注释，避免把说明性路径误判成依赖。 */
function stripComments(src: string): string {
  return src
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** 目标侧：真正的「服务端领域」文件（`lib/core`、`lib/db` 是数据层成员，见头注 ①）。 */
const SERVER_OWNED_RE = /^src\/server\/(?!db\/schema\.ts|db\.ts)/;

/**
 * 登记项：`lib` 侧文件 → `server` 侧目标。**只许变短**（见头注）。曾含 11 个文件 → `src/server/lib/logger.ts`
 * （`lib/comfyui/**`、`lib/drizzle-studio/lifecycle.ts` 与 7 个测试的 `vi.mock`），已全消除：日志实现合并到
 * `src/lib/core/logger.ts`，服务端侧降为转发层；better-auth 那条（需 Next 请求上下文）已按「消息/判决分离」消除，
 * 见 `src/server/auth/request-user.ts` 头注。清单现为**空** = 终态：新边必须先裁决，不得靠「反正已登记一条」。 */
const REGISTERED: Record<string, string> = {};

type Edge = { from: string; to: string };
/** 边的唯一标识。**必须带上目标**：只按源文件判「是否登记过」会把该文件此后
 *  新增的任意依赖一并放行（详见头注「登记粒度是边」）。 */
const key = (e: Edge) => `${e.from} -> ${e.to}`;

/** 已登记的边集合（由 `REGISTERED` 展开）。 */
const REGISTERED_EDGES = new Set(Object.entries(REGISTERED).map(([from, to]) => key({ from, to })));

function collectEdges(): Array<Edge> {
  const edges = new Map<string, Edge>();
  for (const file of walk(join(ROOT, "src", "lib"))) {
    const rel = relative(ROOT, file).split("\\").join("/");
    const src = stripComments(readFileSync(file, "utf8"));
    for (const match of src.matchAll(SPECIFIER_RE)) {
      const spec = match.groups?.spec;
      if (typeof spec !== "string") {
        continue;
      }
      const target = resolveSpec(spec);
      if (target?.startsWith("src/server/") !== true) {
        continue;
      }
      if (!SERVER_OWNED_RE.test(target) && !(rel in REGISTERED)) {
        continue;
      }
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
      `src/lib 是被 server / components / app 共同依赖的地基，新增对 src/server/** 的依赖必须先裁决并登记。\n` +
        `需要日志：改走中立出口 \`@/lib/core/logger\`（pino 的薄封装，接口一致，实现仍只有一份）；\n` +
        `需要别的服务端能力：把被依赖的部分下沉到 lib，或由调用方注入（规范 §12.7 依赖倒置）。\n${
          report
        }`,
    ).toEqual([]);
  });

  it("登记清单没有失效项（依赖已消除的条目必须删掉，棘轮只许变短）", () => {
    const live = new Set(collectEdges().map(key));
    const stale = Object.entries(REGISTERED)
      .filter(([from, to]) => !live.has(key({ from, to })))
      .map(([from, to]) => `  ✗ ${from} -> ${to}`);
    expect(
      stale,
      `以下登记项已不再成立（依赖被消除或目标文件被移动），请从 REGISTERED 中删除：\n${stale.join(
        "\n",
      )}`,
    ).toEqual([]);
  });

  it("判定按「边」而非「源文件」：已登记文件新增别的 server 依赖必须被拦下", () => {
    // 这条用例是回归护栏本身：判定曾写成 `!(e.from in REGISTERED)`，于是
    // 「进过一次清单的文件」此后新增任意 lib → server 依赖都被放行。
    // 用纯数据复现那个谓词，锁住「新边必须算未登记」。
    // 合成一张登记表（与 REGISTERED 现状解耦：这条守的是**判定谓词**，
    // 不是清单内容），只用于复现「同一文件上新增的依赖必须算未登记」。
    const registered = new Map([["src/lib/comfyui/client.ts", "src/server/lib/logger.ts"]]);
    const registeredEdges = new Set([...registered].map(([from, to]) => key({ from, to })));
    const sample: Array<Edge> = [
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
    const specs = [...stripComments(probe).matchAll(SPECIFIER_RE)].map((m) => m.groups?.spec);
    expect(specs, "解析器必须能认出 from 说明符").toEqual(["~/server/better-auth/server"]);
    // 整行 `//` 注释被剥掉（否则说明性路径会被误判成依赖）
    expect(specs).not.toContain("~/server/lib/logger");
    // 说明符能解析到仓库内的真实文件（不是「永远返回 null」）
    expect(resolveSpec("~/server/better-auth/server")).toBe("src/server/better-auth/server.ts");
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
