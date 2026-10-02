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
 *
 * ── 第二个维度：**消费方**（台账 E3′）────────────────────────────────
 *
 * 执行者保证「这条口坏掉时会红」，消费方保证「有人在用它」。两者不是一回事：
 * 一条口可以测试全绿、界面里一个字都没引用 —— 于是它慢慢烂掉，而烂掉的过程
 * 没人看见。本仓库的实例就是 `material.*`：三procedure 各有一整套归属用例
 * （100/100/95/80 那档），而素材库面板从头到尾走的是 REST 的 `/api/materials`
 * —— 同一套判据的两扇门，只有一扇有人走。另一扇不是「多一个入口」，是**多一份
 * 会漂移的实现**（§12.12），所以收口到有人走的那一侧。
 *
 * 判据：每条 procedure 必须能在 `src/**` 的**非测试**代码里找到一处点名它的引用
 * （三种形态见 `consumerNeedles()`），否则就必须出现在 `ZERO_CONSUMER` 里并写明
 * 「谁将来会接它」。登记表还要**双向不陈旧**：口删了登记还留着 = 红；消费方接上
 * 了登记还留着 = 红。
 *
 * 消费方维度的已知边界：
 *  · 剥注释用的是 `tests/helpers/strip-comments.ts`，它**不动行尾注释**（那需要真正的
 *    词法分析）。所以「`foo(); // 参考 task.detail`」这种尾注会被算成消费方 ——
 *    方向是假绿，出现时把那句尾注挪成整行注释即可（别去放宽判据）。
 *  · 只有测试在调 = 零消费方：`tests/` 与 `e2e/` 不在消费面内，这是刻意的。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import { stripComments } from "./helpers/strip-comments";

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

/** 扫描面的唯一来源：两个维度（执行者 / 消费方）都从这一份输入出发。
 *  各扫各的会漂移成「两个维度认的不是同一张挂载表」—— 那正是本判据要抓的形状。 */
function scanSurface() {
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
  const srcFiles = collect(path.join(process.cwd(), "src"));
  /** 执行者面 = 全仓库的测试文件（`src/**` 里的同目录用例也算）。 */
  const tests = [...srcFiles, ...collect(path.join(process.cwd(), "tests"))]
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
  /** 消费面 = `src/**` 里非测试的代码，**注释剥掉**。
   *
   *  刻意不含 `tests/` 与 `e2e/`：只有测试在调的口就是零消费方 —— 那正是
   *  `material.*` 的形状（十八条款归属用例全绿，而素材库面板一个字都没引用它）。 */
  const consumers = srcFiles
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => ({
      base: path.basename(f).replace(/\.tsx?$/, ""),
      text: stripComments(readFileSync(f, "utf8")),
    }));
  const procedurePaths = Object.keys(
    (appRouter._def as unknown as { procedures: Record<string, unknown> })
      .procedures,
  ).sort();
  return { mounts, closures, tests, consumers, procedurePaths };
}

describe("tRPC 挂载面：每条 procedure 都要有执行者（台账 E3）", () => {
  const { mounts, closures, tests, procedurePaths } = scanSurface();

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

/* ── 第二个维度：消费方（台账 E3′）────────────────────────────────────────── */

/** 「零消费方」登记表：口 → 为什么还留着。
 *
 *  这张表不是免罪牌：每条都要写清「谁将来接它」，并且**数量只许降不许升**
 *  （见 `登记表本身不陈旧` 那条用例）。要让这张表变长，得先动台账 E3′，
 *  而不是顺手加一行。
 *
 *  已收口的（不再需要登记，列在这里是为了别再加回来）：
 *   · `material.list` / `material.save` / `material.delete` —— 与 REST 的
 *     `/api/materials` 是同一套归属判据的两扇门，界面只走 REST 那一扇；
 *   · `llm.complete` —— 与 `/api/llm` 重复（那一扇还多带流式与 tools），
 *     它带的 provider / taskType 枚举闸在 `llm.configSave` 上同样有用例。 */
const ZERO_CONSUMER: Record<string, string> = {
  "project.get":
    "画布加载目前从 `project.list` 的行里取 nodes/edges（`lib/project-canvas/canvas-store.ts`），这条按 id 的单读口还没有入口用它。要么把画布改成按需单读（比 list 省），要么删口。",
  "project.patch":
    "画布保存走 `project.upsert`（整份覆盖），这条字段级更新还没有「只改名字 / 只改布局」的界面动作对应。留着的前提是补上那个动作，否则删口。",
  "skill.create":
    "工坊与成片工作室都只**读**风格卡（`skill.list`），技能管理的写侧界面还没做。这一条是「功能未接」而不是「判据缺失」：它的重名 CONFLICT / slug 形状闸都有用例。",
  "train.detail":
    "训练面板从 `train.list` 的行取数（列表就是它的视图），按 id 的详情读口暂无入口。与 `project.get` 同一处置：接上详情页或删口。",
};

/** 登记表长度的棘轮上限（**只许降**）：变长的唯一合法路径是先记进台账 E3′。 */
const MAX_ZERO_CONSUMER = 4;

/** 「有人点名这条口」的三种形态。收不全的形态写在下面的已知边界里。 */
function consumerNeedles(ns: string, proc: string): RegExp[] {
  return [
    // ① 链式点名：`api.project.upsert` / `vanillaApi.skill.list` / `"task.detail"`
    //    （失效键、日志标签这类字符串形状也走这一支）
    new RegExp(`(?<![\\w$])${ns}\\.${proc}(?![\\w$])`),
    // ② 命名空间下用计算属性：`api.project["upsert"]`
    new RegExp(`(?<![\\w$])${ns}\\[\\s*["'\`]${proc}["'\`]\\s*\\]`),
    // ③ 类型层的索引链：`RouterInputs["project"]["upsert"]` —— 改名会编译不过，
    //    所以它确实是消费方（`lib/workshop/generation-client.ts` 就这么用）
    new RegExp(`\\[\\s*["']${ns}["']\\s*\\]\\s*\\.?\\s*\\[\\s*["']${proc}["']`),
  ];
}

type ConsumerInput = {
  mounts: Record<string, string>;
  closures: Record<string, Set<string>>;
  consumers: { base: string; text: string }[];
};

/** 单条口有没有消费方 —— 本维度的唯一实现，主断言与登记表的两条陈旧判据共用。
 *
 *  `consumers` 必须是**去注释后**的文本：注释里写「与 `material.delete` 同一份判据」
 *  是解释，不是调用；让它算消费方就等于把判据挂在文档上。 */
function hasConsumer(dotted: string, input: ConsumerInput): boolean {
  const ns = dotted.split(".")[0]!;
  const proc = dotted.slice(ns.length + 1);
  // 定义这条口的文件闭包不算它自己的消费方（router 内部互指是实现细节，不是使用方）
  const self = input.closures[input.mounts[ns]!] ?? new Set<string>();
  return input.consumers.some(
    ({ base, text }) =>
      !self.has(base) && consumerNeedles(ns, proc).some((r) => r.test(text)),
  );
}

/** 核心判据（纯函数，便于用合成输入自证）：未登记在案、又找不到消费方的口。 */
function proceduresWithoutConsumer(
  input: ConsumerInput & { procedurePaths: string[] },
): string[] {
  return input.procedurePaths.filter(
    (dotted) => !(dotted in ZERO_CONSUMER) && !hasConsumer(dotted, input),
  );
}

describe("tRPC 挂载面：每条 procedure 都要有消费方（台账 E3′）", () => {
  const { mounts, closures, consumers, procedurePaths } = scanSurface();

  it("消费面本身不是空的，且大多数口都找得到消费方（判据不许在空输入上假绿）", () => {
    expect(consumers.length).toBeGreaterThan(100);
    const covered = procedurePaths.filter((dotted) =>
      hasConsumer(dotted, { mounts, closures, consumers }),
    );
    // 登记在案的只有个位数，找到消费方的必须是大头。
    // 这条断言挡的是「needle 三种形态全都失效 ⇒ 每条都报零消费 ⇒ 于是有人去放宽判据」
    // 这种反向的坏修法。
    expect(covered.length).toBeGreaterThan(30);
  });

  it("没登记在案的口都必须有消费方", () => {
    const offenders = proceduresWithoutConsumer({
      procedurePaths,
      mounts,
      closures,
      consumers,
    });
    expect(offenders).toEqual([]);
  });

  it("登记表本身不陈旧：每条都要有原因、口还在、且真的还没人用", () => {
    expect(Object.keys(ZERO_CONSUMER).length).toBeLessThanOrEqual(
      MAX_ZERO_CONSUMER,
    );
    for (const [dotted, reason] of Object.entries(ZERO_CONSUMER)) {
      // 原因不能是空壳（「TODO」这类）：一张只写 TODO 的登记表 = 没有登记表
      expect(reason.length, `${dotted} 的登记理由太短`).toBeGreaterThan(30);
      expect(procedurePaths, `${dotted} 已经不存在，登记该删掉`).toContain(
        dotted,
      );
      expect(
        hasConsumer(dotted, { mounts, closures, consumers }),
        `${dotted} 已经有消费方了，把登记撤掉`,
      ).toBe(false);
    }
  });

  it("判据自身可反证：三种点名形态、注释、以及登记表的陈旧都要判对", () => {
    const base = {
      mounts: { ghost: "ghost" },
      closures: { ghost: new Set(["ghost"]) },
    };
    /** 走真实管线的同一步：先剥注释再点名 —— 否则这条反证在测一个不存在的输入形状。 */
    const input = (text: string) => ({
      ...base,
      procedurePaths: ["ghost.useIt"],
      consumers: [{ base: "panel", text: stripComments(text) }],
    });
    // ① 链式点名
    expect(
      proceduresWithoutConsumer(input("api.ghost.useIt.useQuery();")),
    ).toEqual([]);
    // ② 计算属性
    expect(
      proceduresWithoutConsumer(input('api.ghost["useIt"].mutate({});')),
    ).toEqual([]);
    // ③ 类型层索引链
    expect(
      proceduresWithoutConsumer(
        input('type X = RouterInputs["ghost"]["useIt"];'),
      ),
    ).toEqual([]);
    // 名字只出现在注释里 → 不算消费方（这条是本判据最容易松的地方）
    expect(
      proceduresWithoutConsumer(
        input("// 与 ghost.useIt 同一份判据，只是文档里提了一句\n"),
      ),
    ).toEqual(["ghost.useIt"]);
    // 定义它自己的那份 router 文件 → 不算消费方
    expect(
      proceduresWithoutConsumer({
        ...base,
        procedurePaths: ["ghost.useIt"],
        consumers: [{ base: "ghost", text: "api.ghost.useIt.useQuery();" }],
      }),
    ).toEqual(["ghost.useIt"]);
    // 登记在案的口不进主断言（否则主断言会一直红在欠账上），但同一份消费方
    // 输入下 `hasConsumer` 必须说真话 —— 另一条用例就是靠它把「已经接上的登记」判红
    expect(
      proceduresWithoutConsumer({
        ...base,
        procedurePaths: ["project.get"],
        consumers: [{ base: "panel", text: "api.project.get.useQuery();" }],
      }),
    ).toEqual([]);
    expect(
      hasConsumer("project.get", {
        ...base,
        mounts: { ...base.mounts, project: "project" },
        closures: { ...base.closures, project: new Set(["project"]) },
        consumers: [{ base: "panel", text: "api.project.get.useQuery();" }],
      }),
    ).toBe(true);
    // 完全没有消费方、又没登记 → 必须报（这才是「新加一条没人用的口」的形状）
    expect(
      proceduresWithoutConsumer({
        ...base,
        procedurePaths: ["ghost.useIt"],
        consumers: [],
      }),
    ).toEqual(["ghost.useIt"]);
  });
});
