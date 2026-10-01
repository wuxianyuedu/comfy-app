/**
 * 「挂载即欠执行者」判据（台账 E3 收官）。
 *
 * 一句话：`src/server/api/root.ts` 每挂一个命名空间，它的**每一条 procedure**
 * 都必须在某个测试文件里被真正调用过。缺一条就红。
 *
 * 为什么判「有没有执行者」而不是「有没有测试文件」：E3 这条线一批批补下来
 * （project / task / setting / material / film / train / model / llm / skill /
 * workflowModel / generate / run），反复撞见同一个断层 —— **router 挂了、
 * 也能调通、但没有任何东西调用过它**。这种口坏掉时全绿：
 *  · `train.cancel` 自 Prisma→Drizzle 迁移起每次都 500（台账 F13），而它零执行者，
 *    所以那句 500 从来没有变成任何一条红；
 *  · `customNode.list` 把 `nodes` 写死成 `[]`、还顺手把整个 settings 回给客户端
 *    （本机路径与开关状态），零执行者、零消费方；
 *  · `post.getLatest` 那句注释写着「OWASP A01：要求已登录用户」，而
 *    `loginRequired` 默认 false ⇒ 匿名可读全表，且没人读它。
 *  后两个是本批删掉的。只补「每个 router 一份测试文件」挡不住第三条：文件在、
 *  某几条 procedure 照样零执行者 —— 本判据因此落到 procedure 粒度。
 *
 * 判据的两条腿（都不可省）：
 *  1. 测试文件要 **import 该 router 的文件闭包**（`workflow` 那种聚合 router
 *     把 procedure 拆在 `workflow-detail.ts` / `workflow-list.ts` 里，只认
 *     挂载文件会把它们的执行者判丢）；
 *  2. 同一个文件里要出现 `<procedureName>(` 这一调用形态。
 *     只认 (1) = 「有个测试文件提到过这个名字」；只认 (2) = 随便哪份测试里的
 *     `delete(` 都能冒充执行者。两条一起才既是「跑过」又是「跑的是这条」。
 *
 * 已知边界（写在判据旁边，不假装没有）：
 *  · 名字匹配是**文本级**的。若某条 procedure 的调用是 `caller()[name]()`
 *    这种拼出来的形态，本判据看不见 ⇒ 会报红。假红比假绿好修：改成显式调用；
 *    确实要留那种形态的，才在下面加一份带原因的豁免清单（装机时存量为零，
 *    所以现在还没有这条通道 —— 别为了一个不存在的调用方先把它建起来）。
 *  · 「有执行者」不等于「断言有效」。有效性由 `pnpm run check:all` 的 coverage
 *    门槛与逐批的反向验证负责，本判据只保证「不会有条口从来没人调用过」。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { appRouter } from "~/server/api/root";

const ROUTER_DIR = "src/server/api/routers";

/** 递归收集 `src` 与 `tests` 下的 `.ts` / `.tsx`（跳过构建产物与生成物）。 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated")
      continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** root.ts 的挂载表：命名空间 → 该 router 的源文件基名（不含扩展名）。 */
function mountTable(source: string): Record<string, string> {
  const varToFile: Record<string, string> = {};
  for (const m of source.matchAll(
    /import\s+\{\s*(\w+)\s*\}\s+from\s+"~\/server\/api\/routers\/([\w-]+)"/g,
  )) {
    varToFile[m[1]!] = m[2]!;
  }
  const mounts: Record<string, string> = {};
  for (const m of source.matchAll(/^\s{2}(\w+):\s*(\w+),$/gm)) {
    const file = varToFile[m[2]!];
    if (file) mounts[m[1]!] = file;
  }
  return mounts;
}

/** 一个 router 文件的「文件闭包」：它自己 + 沿 `routers/` 目录里的 import 链
 *  拉进来的所有 router 文件（聚合 router 的 procedure 住在拆出去的兄弟文件里）。 */
function routerClosure(
  entry: string,
  sources: Map<string, string>,
): Set<string> {
  const closure = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);
    const text = sources.get(current);
    if (!text) continue;
    for (const m of text.matchAll(
      /from\s+"(?:~\/server\/api\/routers|\.)\/?([\w-]+)"/g,
    )) {
      const next = m[1]!;
      if (next !== current && sources.has(next)) queue.push(next);
    }
  }
  return closure;
}

/** 测试文件是否 import 了闭包里的某个 router 文件（`from "./workflow"`、
 *  `from "~/server/api/routers/workflow"`、以及 `import("…")` 的动态形态都认）。 */
function importsClosure(testText: string, closure: Set<string>): boolean {
  for (const m of testText.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spec = m[1]!;
    if (!/^(?:~\/server\/api\/routers|\.)/.test(spec)) continue;
    const base = spec.split("/").pop()!;
    if (closure.has(base)) return true;
  }
  return false;
}

/** 「这条 procedure 被调用过」的调用形态：`caller().list(` / `caller.detail(`。
 *  前面的负向断言排除 `plist(` 这类同尾名字。 */
function callNeedle(proc: string): RegExp {
  return new RegExp(`(?<![\\w$])${proc}\\s*\\(`);
}

/** 核心判据（纯函数，便于下面用合成输入自证它在工作）：
 *  返回「没有任何执行者」的 procedure 路径。 */
function proceduresWithoutExecutor(input: {
  procedurePaths: string[];
  mounts: Record<string, string>;
  closures: Record<string, Set<string>>;
  tests: { file: string; text: string }[];
}): string[] {
  const offenders: string[] = [];
  for (const dotted of input.procedurePaths) {
    const ns = dotted.split(".")[0]!;
    const proc = dotted.slice(ns.length + 1);
    const closure = input.closures[input.mounts[ns]!] ?? new Set<string>();
    const executed = input.tests.some(
      ({ text }) =>
        importsClosure(text, closure) && callNeedle(proc).test(text),
    );
    if (!executed) offenders.push(dotted);
  }
  return offenders;
}

describe("tRPC 挂载面：每条 procedure 都要有执行者（台账 E3）", () => {
  const sources = new Map<string, string>();
  for (const f of collect(path.join(process.cwd(), ROUTER_DIR))) {
    const base = path.basename(f).replace(/\.tsx?$/, "");
    if (base.endsWith(".test")) continue;
    sources.set(base, readFileSync(f, "utf8"));
  }
  const rootText = readFileSync(
    path.join(process.cwd(), "src/server/api/root.ts"),
    "utf8",
  );
  const mounts = mountTable(rootText);
  const closures: Record<string, Set<string>> = {};
  for (const file of new Set(Object.values(mounts))) {
    closures[file] = routerClosure(file, sources);
  }
  const tests = [
    ...collect(path.join(process.cwd(), "src")),
    ...collect(path.join(process.cwd(), "tests")),
  ]
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  const procedurePaths = Object.keys(
    (appRouter._def as unknown as { procedures: Record<string, unknown> })
      .procedures,
  ).sort();

  it("扫描面本身不是空的（判据不许在空输入上假绿）", () => {
    // 三个维度各自非空：少任何一条，下面的主断言都会退化成「无话可说 = 全过」。
    expect(procedurePaths.length).toBeGreaterThan(40);
    expect(Object.keys(mounts).length).toBeGreaterThan(8);
    expect(tests.length).toBeGreaterThan(50);
  });

  it("每个挂载的命名空间都在 root.ts 登记了源文件", () => {
    const unmounted = procedurePaths.filter((p) => !mounts[p.split(".")[0]!]);
    expect(unmounted).toEqual([]);
  });

  it("每条 procedure 都被某份测试调用过", () => {
    const offenders = proceduresWithoutExecutor({
      procedurePaths,
      mounts,
      closures,
      tests,
    });
    // 红的时候直接把「该写哪份测试」打到断言消息里
    expect(offenders).toEqual([]);
  });

  it("判据自身可反证：合成一条零执行者的口必须被报出来", () => {
    const base = {
      mounts: { ghost: "ghost" },
      closures: { ghost: new Set(["ghost"]) },
    };
    // 完全没有测试文件 → 必须报
    expect(
      proceduresWithoutExecutor({
        ...base,
        procedurePaths: ["ghost.neverCalled"],
        tests: [],
      }),
    ).toEqual(["ghost.neverCalled"]);
    // 有一份 import 了该 router 且调用到的测试 → 必须不报
    expect(
      proceduresWithoutExecutor({
        ...base,
        procedurePaths: ["ghost.neverCalled"],
        tests: [
          {
            file: "routers/ghost.test.ts",
            text:
              'import { ghostRouter } from "./ghost";\n' +
              "const caller = createCaller();\n" +
              "await caller.neverCalled({ id: 1 });\n",
          },
        ],
      }),
    ).toEqual([]);
    // 只 import 不调用 → 必须报（「有个文件提到过这个 router」不算执行者）
    expect(
      proceduresWithoutExecutor({
        ...base,
        procedurePaths: ["ghost.neverCalled"],
        tests: [{ file: "routers/ghost.test.ts", text: 'import "./ghost";' }],
      }),
    ).toEqual(["ghost.neverCalled"]);
    // 调用了同名但没 import 该 router → 必须报（别的文件里的 `neverCalled(` 不算）
    expect(
      proceduresWithoutExecutor({
        ...base,
        procedurePaths: ["ghost.neverCalled"],
        tests: [{ file: "elsewhere.test.ts", text: "thing.neverCalled();" }],
      }),
    ).toEqual(["ghost.neverCalled"]);
  });
});
