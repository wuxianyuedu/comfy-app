/**
 * 根 `test` 上的共享项**真的落到了两个 project 上**吗（规范 §11.17.3）。
 *
 * 动因：这一档的口径在本仓库**写反过一次**。`vitest.config.ts` 里曾经立着一个
 * `SHARED_TEST_OPTIONS` 常量、两个 project 各 spread 一次，理由写的是
 * 「`projects` 不继承声明方 `test` 的选项（实测）」。本轮按仓库规矩去复现那次实测，
 * 结论是**那次测量站不住**：vitest 5 的 inline project（`projects: [{ test: {…} }]`）
 * 默认继承本文件 `test` 这一层的选项，`extends: false` 才是关掉它的开关。
 * 所以共享项回到了根 `test` 上、那一层复制消失 —— 而**口径改对了不等于以后不会写回去**。
 *
 * 这条判据的形状与 §11.17.1.2「冗余文件头」同族：**同一件事只该有一个来源**。
 * 但判法不同 —— 那条能纯文本判（glob 能算），这一条**判不了**：
 * 「共享项有没有生效」是 vitest 解析配置的结果，不是配置文本的形状。
 * 所以这里**用 vitest 自己的 `createVitest()`**（`vitest/node`）把配置解析出来，
 * 逐档读 `project.config` 上的**解析后**取值。
 * ⚠️ 不自己写一份「继承规则」或 glob 引擎 —— #1509 那轮手写 glob 引擎算覆盖，
 * 把 `src/components/ui` 误判成「已覆盖」，删完当场被 `vitest list` 揭穿。
 *
 * 判四件：
 *   1. **两档都拿到了**共享项（不是「至少一档」—— 失效形态正是一档落后）；
 *   2. **`extends` 没被关掉**（写 `extends: false` 是唯一的例外口，得显式登记理由）；
 *   3. 根 `test` 上的**共享项白名单**没被塞进「只对某档有意义」的项
 *      （`environment` 写根上会让两档同环境，正是 §11.17 整套分档要防的事）；
 *   4. project 里**不再重复声明**共享项（同一件事两个来源）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVitest, type Vitest } from "vitest/node";

import { resolveCiWorkers } from "../scripts/ci-load.mjs";
import { resolveTimeoutBudget } from "../vitest.config";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(ROOT, "vitest.config.ts");

/**
 * 根配置**自己**那一档并发：来自唯一出处 `scripts/ci-load.mjs`（ISSUE #2324），
 * 不是这里写死的数字。表里放推导值仍然抓得住漂移 —— 谁把 `vitest.config.ts`
 * 改回字面常数（例如 8），配置读数与这一格就不相等，当场红。
 */
const ROOT_WORKERS = resolveCiWorkers().workers;

/**
 * 共享项 ⇒ 期望值。**这就是「一处定义」的那张表**：
 * 新增一项根级共享项时，同批加在这里（否则第 4 条会红 —— 那正是它的用意）。
 */
const SHARED_EXPECTATIONS = /* SAFETY: 类型断言已复核 */ {
  setupFiles: ["tests/setup.ts"],
  globals: false,
  /* 判据预算不写死：生效值由 `vitest.config.ts` 的 `resolveTimeoutBudget()` 按
   * `COMFY_TEST_TIMEOUT_SCALE` 算（ISSUE #2959），缺省乘数 1 ⇒ 与历史的 30_000 / 45_000
   * 逐字相同。这一格判的是「**两档拿到了同一个值**」，不是「这个值必须是我印象里的那个数」
   * —— 后者会在 CI 按乘数放宽时变成一条与它要判的事无关的假红（而它的失效形态恰恰是
   * 「一档落后」，那件事乘数放宽时照样判得出来）。 */
  testTimeout: resolveTimeoutBudget(process.env.COMFY_TEST_TIMEOUT_SCALE).testTimeout,
  hookTimeout: resolveTimeoutBudget(process.env.COMFY_TEST_TIMEOUT_SCALE).hookTimeout,
  maxWorkers: ROOT_WORKERS,
} as const;

/** `expect.poll` 的预算（对象形状，单独比）。 */
const EXPECT_POLL = { timeout: 4000, interval: 50 };

/**
 * 根 `test` **允许**出现的项（共享白名单）。
 *
 * `projects` 是分档本身；`coverage` 按文档只由根配置认（不进 project）——
 * 两者都**不是**要被两档继承的东西。新增根级项时先回答「它是共享的吗」，
 * 是就往 `SHARED_EXPECTATIONS` 里加，不是就往这里加并写清理由。
 */
const ROOT_ALLOWED_KEYS = new Set([
  "projects",
  "coverage",
  ...Object.keys(SHARED_EXPECTATIONS),
  "expect",
]);

/**
 * 期望分档：按目录声明的两档（§11.17），少一档 / 多一档都要有人解释。
 *
 * ⚠️ **DOM 档的 `name` 与它的 `environment` 是两个字段**（本轮加档后的口径）：
 * `name: "happy-dom"` 是**这一档是谁**（也决定了 `vitest list` 打出来的 `[标签]`），
 * `environment: "happy-dom"` 是**它默认跑在哪个实现上**。两者当前同名，
 * 但**不是**同一件事 —— 档里的少数用例可以用文件头
 * `// @vitest-environment jsdom` 改跑在另一个实现上，而档名不变。
 * 测试下面的 `environment` 断言读的是后者；`EXPECTED_PROJECTS` 读的是前者。
 */
const EXPECTED_PROJECTS = ["happy-dom", "node"];

/**
 * 每档的**默认环境实现**（`environment`）。
 *
 * 这一格单独成表而不是从档名推：把 `environment` 写成 `name` 的副本，
 * 会让「给 DOM 档换一个实现（jsdom ⟷ happy-dom）」这类改动在**不改判据**的
 * 情况下直接通过 —— 而它正是本档最值得被人看一眼的那次改动（代价与保真度
 * 都随之整档变化）。§11.17.1.2「同一件事只该有一个来源」的另一面：
 * 两个字段各自说自己的话，就不许拿一个去顶另一个。
 */
const EXPECTED_TIER_ENVIRONMENTS = /* SAFETY: 类型断言已复核 */ {
  node: "node",
  "happy-dom": "happy-dom",
} as const;

/** 解析一次就够 —— `createVitest()` 实测 ~260ms，且它只建配置不起 worker。 */
let cached: Vitest | undefined;
async function resolvedVitest(): Promise<Vitest> {
  cached ??= await createVitest("test", { run: true, config: CONFIG });
  return cached;
}

describe("根 `test` 的共享项落到两个 project 上（§11.17.3）", () => {
  it("两档都在，且命名与文档一致", async () => {
    const vitest = await resolvedVitest();
    expect(vitest.projects.map((p) => p.name).sort()).toEqual(EXPECTED_PROJECTS);
  });

  it("**每一档**都拿到了共享项（失效形态是一档落后，所以逐档判）", async () => {
    const vitest = await resolvedVitest();
    for (const project of vitest.projects) {
      const cfg = /* SAFETY: 类型断言已复核 */ project.config as unknown as Record<string, unknown>;
      const prefix = `[${project.name}]`;
      // setupFiles 在解析后是**绝对路径**，所以比形状（落在仓库根之下、名字对）。
      const setupFiles = /* SAFETY: 类型断言已复核 */ cfg.setupFiles as Array<string>;
      /* 比较前归一分隔符：`path.relative()` 在 win32 上给出 `tests\setup.ts`，而期望
         值按配置源码写成 POSIX 形式 —— 不归一的话这条判据在每台 Windows 上都红，
         且红的原因与它要判的事（共享项有没有落到每一档）毫无关系。 */
      expect(
        setupFiles.map((f) => path.relative(ROOT, f).split("\\").join("/")),
        prefix,
      ).toEqual(SHARED_EXPECTATIONS.setupFiles);
      expect(cfg.globals, prefix).toBe(SHARED_EXPECTATIONS.globals);
      expect(cfg.testTimeout, prefix).toBe(SHARED_EXPECTATIONS.testTimeout);
      expect(cfg.hookTimeout, prefix).toBe(SHARED_EXPECTATIONS.hookTimeout);
      expect(cfg.maxWorkers, prefix).toBe(SHARED_EXPECTATIONS.maxWorkers);
      expect(
        /* SAFETY: 类型断言已复核 */ (cfg.expect as { poll?: unknown } | undefined)?.poll,
        prefix,
      ).toEqual(EXPECT_POLL);
    }
  });

  /**
   * `environment` 是这套分档里**唯一按档分叉**的项，所以它必须留在 project 内部。
   * 这一条判的是「它没被顺手抬到根上」—— 抬上去的表现是两档同环境，
   * 而 DOM 档下跑纯逻辑**不报错、只是变慢**（静默的那一侧，§11.17.1）。
   */
  it("`environment` 按档分叉，没被抬到根级共享（那正是分档要防的事）", async () => {
    const vitest = await resolvedVitest();
    const byName = new Map(vitest.projects.map((p) => [p.name, p.config]));
    for (const [name, env] of Object.entries(EXPECTED_TIER_ENVIRONMENTS)) {
      expect(byName.get(name)?.environment, `[${name}]`).toBe(env);
    }
  });

  it("没有一档写 `extends: false` 把自己摘出继承（例外要显式登记）", async () => {
    const vitest = await resolvedVitest();
    // `extends` 在解析后的配置上不会原样留名，改用它的**结果**判：
    // 关掉继承的那一档拿不到共享项 —— 由上面「逐档都拿到了」那一条兜住。
    // 这里只钉住「两档都不缺失」，并留一处源码级断言防住 `extends: false` 字样回来。
    const { readFile } = await import("node:fs/promises");
    const source = stripComments(await readFile(CONFIG, "utf8"));
    expect(source).not.toMatch(/extends\s*:\s*false/);
    for (const project of vitest.projects) {
      expect(
        /* SAFETY: 类型断言已复核 */ (project.config as unknown as Record<string, unknown>).globals,
        `[${project.name}] 共享项缺席 = 这一档把继承关掉了`,
      ).toBe(SHARED_EXPECTATIONS.globals);
    }
  });

  it("根 `test` 上没有「只对某档有意义」的项，project 里不再重复声明共享项", async () => {
    // 这一条判**配置文本**（解析后看不出「它写在哪一层」），用 TS 模块直接读默认导出。
    const mod = /* SAFETY: 类型断言已复核 */ (await import(
      path.join(ROOT, "vitest.config.ts")
    )) as {
      default: { test: Record<string, unknown> };
    };
    const rootTest = mod.default.test;
    const extra = Object.keys(rootTest).filter((k) => !ROOT_ALLOWED_KEYS.has(k));
    expect(extra, "新增根级项先回答「它是不是共享项」").toEqual([]);

    /**
     * **声明**在根上，不只是「解析出来的值恰好对」。
     *
     * 这两件事不等价，实测撞出来的：把根上的 `globals: false` 整行删掉，
     * 上面「逐档都拿到了」那条**照样全绿** —— 因为 `globals` 的出厂值本来就是
     * `false`（`configDefaults.globals === false`），删了它解析结果一个字不变。
     * 也就是说 `globals: false` 这一行是**文档**（写明「与仓里既有口径一致：
     * 不注入全局」），不是行为；只按解析值判，就等于允许它被顺手删掉而没人发现。
     * 判「声明在不在」才是这一条的本意（同 §11.17.1.2：同一件事只该有一个来源）。
     */
    const declared = Object.keys(rootTest);
    for (const key of Object.keys(SHARED_EXPECTATIONS)) {
      expect(declared, `共享项 \`${key}\` 该声明在根 \`test\` 上`).toContain(key);
    }

    const projects = /* SAFETY: 类型断言已复核 */ rootTest.projects as Array<{
      test: Record<string, unknown> & { name?: string };
    }>;
    for (const entry of projects) {
      const duplicated = Object.keys(entry.test).filter((k) =>
        Object.keys(SHARED_EXPECTATIONS).includes(k),
      );
      expect(duplicated, `[${String(entry.test.name)}] 共享项该只在根 \`test\` 上定义一次`).toEqual(
        [],
      );
    }
  });
});

/**
 * 判据预算的**临时乘数**（ISSUE #2959）—— 它必须既买得到余量，又收得回原状。
 *
 * 这一格存在是因为「临时放宽」这四个字在仓库里最容易腐化成两种形状：
 *   ① 有人把 `testTimeout` 直接改成 60_000（那就没人知道原来是 30_000、也没人知道
 *      什么时候该收回 —— §13.6.4 明令禁止的那个动作）；
 *   ② 放宽之后日志里读不出来（于是下一次「这台机器为什么这么慢」会去查配置）。
 * 所以判四件事：缺省 = 原值、乘数按上限截断并说出口、生效值真的落到 vitest 解析后的配置上、
 * 而 `.cnb.yml` 里那一行就是「临时」的全部承重。
 */
describe("判据预算的临时乘数（ISSUE #2959）", () => {
  it("缺省（不设变量）与放宽前逐字相同 —— 收回去不需要改代码", () => {
    for (const raw of [undefined, "", "  "]) {
      const got = resolveTimeoutBudget(raw);
      expect(got.scale, String(raw)).toBe(1);
      expect(got.testTimeout).toBe(30_000);
      expect(got.hookTimeout).toBe(45_000);
      expect(got.note).toBeNull();
    }
  });

  it("按乘数放宽，且两条预算同比例（只放宽一条会让钩子比用例更早红）", () => {
    const got = resolveTimeoutBudget("2");
    expect(got.testTimeout).toBe(60_000);
    expect(got.hookTimeout).toBe(90_000);
  });

  it("非法值 / 超上限落回 1 并说出口，不静默算成一个怪数", () => {
    for (const bad of ["0", "-2", "abc", "4", "1e9"]) {
      const got = resolveTimeoutBudget(bad);
      expect(got.scale, bad).toBe(1);
      expect(got.testTimeout, bad).toBe(30_000);
      expect(got.note, bad).toBeTruthy();
    }
  });

  it("这一跑**实际生效**的值就是乘数算出来的（不是只改了常量）", async () => {
    const vitest = await resolvedVitest();
    const expected = resolveTimeoutBudget(process.env.COMFY_TEST_TIMEOUT_SCALE);
    for (const project of vitest.projects) {
      const cfg = /* SAFETY: 类型断言已复核 */ project.config as unknown as Record<string, unknown>;
      expect(cfg.testTimeout, `[${project.name}]`).toBe(expected.testTimeout);
      expect(cfg.hookTimeout, `[${project.name}]`).toBe(expected.hookTimeout);
    }
  });

  it("`COMFY_TEST_TIMEOUT_SCALE` 是流水线级 env 里**唯一**的一行（那是「临时」的承重处）", () => {
    const text = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    const hits = text.split("\n").filter((line) => /^\s*COMFY_TEST_TIMEOUT_SCALE\s*:/.test(line));
    expect(
      hits,
      "这个键只该在 `.common` 的 `env:` 里出现一次 —— 写进某一格就只有那一格放宽",
    ).toHaveLength(1);
    /* 值必须是「置着」的形态：空值 / 非数字 / 超过 3 都等于没放宽或放宽过头，
     * 而这两种在日志里只差一行 note。 */
    expect(hits[0]).toMatch(/:\s*"?(1(\.\d+)?|2(\.\d+)?|3(\.\d+)?)"?\s*$/);
  });
});
