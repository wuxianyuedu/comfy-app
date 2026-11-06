/**
 * 「挂载即欠执行者」判据（台账 E3）：`src/server/api/root.ts` 每条 procedure 都须被测试真调用，否则红。
 * 落到 procedure 粒度：`train.cancel`（500 零执行者，台账 F13）、`customNode.list`（`nodes` 写死 `[]` 且回吐 settings）曾全绿。
 * 两条腿不可省：import router 的文件闭包（procedure 拆在 `workflow-*.ts`）且同文件出现 `<procedureName>(`；「消费方」见 `ZERO_CONSUMER`。
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
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { appRouter } from "~/server/api/root";

const ROUTER_DIR = "src/server/api/routers";

/** 递归收集 `src` 与 `tests` 下的 `.ts` / `.tsx`（跳过构建产物与生成物）。 */
function collect(dir: string, out: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated") {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (/\.(?:ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** root.ts 的挂载表：命名空间 → 该 router 的源文件基名（不含扩展名）。 */
function mountTable(source: string): Record<string, string> {
  const varToFile: Record<string, string> = {};
  for (const m of source.matchAll(
    /import\s+\{\s*(?<var>\w+)\s*\}\s+from\s+"~\/server\/api\/routers\/(?<router>[\w-]+)"/g,
  )) {
    varToFile[m.groups?.var ?? ""] = m.groups?.router ?? "";
  }
  const mounts: Record<string, string> = {};
  for (const m of source.matchAll(/^\s{2}(?<name>\w+):\s*(?<value>\w+),$/gm)) {
    const file = varToFile[m.groups?.value ?? ""];
    if (file !== undefined && file !== "") {
      mounts[m.groups?.name ?? ""] = file;
    }
  }
  return mounts;
}

/** 一个 router 文件的「文件闭包」：它自己 + 沿 `routers/` 目录里的 import 链
 *  拉进来的所有 router 文件（聚合 router 的 procedure 住在拆出去的兄弟文件里）。 */
function routerClosure(entry: string, sources: Map<string, string>): Set<string> {
  const closure = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const current = queue.shift()!;
    if (closure.has(current)) {
      continue;
    }
    closure.add(current);
    const text = sources.get(current);
    if (text === undefined || text === "") {
      continue;
    }
    for (const m of text.matchAll(/from\s+"(?:~\/server\/api\/routers|\.)\/?(?<name>[\w-]+)"/g)) {
      const next = m.groups?.name ?? "";
      if (next !== current && sources.has(next)) {
        queue.push(next);
      }
    }
  }
  return closure;
}

/** 测试文件是否 import 了闭包里的某个 router 文件（`from "./workflow"`、
 *  `from "~/server/api/routers/workflow"`、以及 `import("…")` 的动态形态都认）。 */
function importsClosure(testText: string, closure: Set<string>): boolean {
  for (const m of testText.matchAll(/(?:from|import)\s*\(?\s*"(?<spec>[^"]+)"/g)) {
    const spec = m.groups?.spec ?? "";
    if (!/^(?:~\/server\/api\/routers|\.)/.test(spec)) {
      continue;
    }
    const base = spec.split("/").pop()!;
    if (closure.has(base)) {
      return true;
    }
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
  closures: Record<string, Set<string>>;
  mounts: Record<string, string>;
  procedurePaths: Array<string>;
  tests: Array<{ file: string; text: string }>;
}): Array<string> {
  const offenders: Array<string> = [];
  for (const dotted of input.procedurePaths) {
    const ns = dotted.split(".")[0]!;
    const proc = dotted.slice(ns.length + 1);
    const closure = input.closures[input.mounts[ns]!] ?? new Set<string>();
    const executed = input.tests.some(
      ({ text }) => importsClosure(text, closure) && callNeedle(proc).test(text),
    );
    if (!executed) {
      offenders.push(dotted);
    }
  }
  return offenders;
}

/** 扫描面的唯一来源：两个维度（执行者 / 消费方）都从这一份输入出发。
 *  各扫各的会漂移成「两个维度认的不是同一张挂载表」—— 那正是本判据要抓的形状。 */
function scanSurface() {
  const sources = new Map<string, string>();
  for (const f of collect(path.join(process.cwd(), ROUTER_DIR))) {
    const base = path.basename(f).replace(/\.tsx?$/, "");
    if (base.endsWith(".test")) {
      continue;
    }
    sources.set(base, readFileSync(f, "utf8"));
  }
  const rootText = readFileSync(path.join(process.cwd(), "src/server/api/root.ts"), "utf8");
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
  /* SAFETY: 类型断言已复核 */
  const procedurePaths = Object.keys(
    (appRouter._def as unknown as { procedures: Record<string, unknown> }).procedures,
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
    const unmounted = procedurePaths.filter(
      (p) => mounts[p.split(".")[0]!] === undefined || mounts[p.split(".")[0]!] === "",
    );
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

/**
 * 「零消费方」登记表：口 → 为什么还留着。不是免罪牌：每条写清「谁将来接它」，数量只许降不许升（见 `登记表本身不陈旧`）。
 * 要变长得先动台账 E3′。已收口的（别再写回来）：`material.*` 与 REST `/api/materials` 是同一套归属判据的
 * 两扇门，界面只走 REST；`llm.complete` 与 `/api/llm` 重复（那扇还多流式与 tools）。
 */
const ZERO_CONSUMER: Record<string, string> = {
  "project.get":
    "画布加载目前从 `project.list` 的行里取 nodes/edges（`lib/project-canvas/canvas-store.ts`），这条按 id 的单读口还没有入口用它。要么把画布改成按需单读（比 list 省），要么删口。",
  "project.patch":
    "画布保存走 `project.upsert`（整份覆盖），这条字段级更新还没有「只改名字 / 只改布局」的界面动作对应。留着的前提是补上那个动作，否则删口。",
  "skill.create":
    "工坊与成片工作室都只**读**风格卡（`skill.list`），技能管理的写侧界面还没做。这一条是「功能未接」而不是「判据缺失」：它的重名 CONFLICT / slug 形状闸都有用例。",
};

/** 登记表长度的棘轮上限（**只许降**）：变长的唯一合法路径是先记进台账 E3′。 */
const MAX_ZERO_CONSUMER = 3;

/** 「有人点名这条口」的三种形态。收不全的形态写在下面的已知边界里。 */
function consumerNeedles(ns: string, proc: string): Array<RegExp> {
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
  closures: Record<string, Set<string>>;
  consumers: Array<{ base: string; text: string }>;
  mounts: Record<string, string>;
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
    ({ base, text }) => !self.has(base) && consumerNeedles(ns, proc).some((r) => r.test(text)),
  );
}

/** 核心判据（纯函数，便于用合成输入自证）：未登记在案、又找不到消费方的口。 */
function proceduresWithoutConsumer(
  input: ConsumerInput & { procedurePaths: Array<string> },
): Array<string> {
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
    expect(Object.keys(ZERO_CONSUMER).length).toBeLessThanOrEqual(MAX_ZERO_CONSUMER);
    for (const [dotted, reason] of Object.entries(ZERO_CONSUMER)) {
      // 原因不能是空壳（「TODO」这类）：一张只写 TODO 的登记表 = 没有登记表
      expect(reason.length, `${dotted} 的登记理由太短`).toBeGreaterThan(30);
      expect(procedurePaths, `${dotted} 已经不存在，登记该删掉`).toContain(dotted);
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
    expect(proceduresWithoutConsumer(input("api.ghost.useIt.useQuery();"))).toEqual([]);
    // ② 计算属性
    expect(proceduresWithoutConsumer(input('api.ghost["useIt"].mutate({});'))).toEqual([]);
    // ③ 类型层索引链
    expect(proceduresWithoutConsumer(input('type X = RouterInputs["ghost"]["useIt"];'))).toEqual(
      [],
    );
    // 名字只出现在注释里 → 不算消费方（这条是本判据最容易松的地方）
    expect(
      proceduresWithoutConsumer(input("// 与 ghost.useIt 同一份判据，只是文档里提了一句\n")),
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
