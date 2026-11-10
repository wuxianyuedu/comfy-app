/**
 * 根 `test` 的共享项是否**真的落到两个 project**上（§11.17.3）。此口径曾写反：vitest 5 inline project 默认继承
 * 根 `test`，`extends: false` 才是关掉的开关，故共享项回到根上。判四件：两档都拿到、`extends` 未关、根级
 * 白名单无分档专属项、project 不重复声明；用 `createVitest()` 读解析值，不手写继承规则 / glob（#1509）。
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
/* SAFETY: 类型断言已复核 */
const SHARED_EXPECTATIONS = {
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
  /* `reporters`（2026-11-09）：显式钉 `["default"]`，关掉 vitest 在 `GITHUB_ACTIONS=true`
   * 下自动追加的 `github-actions` reporter —— 它每个 vitest 进程各往 `$GITHUB_STEP_SUMMARY`
   * 写一份 `Vitest Test Report`，一次 job 几个进程就有几段互相矛盾的计数。两档都要这份
   * 钉法，所以它是共享项；判据 `tests/vitest-gha-summary.test.ts` 从终态正面钉。 */
  reporters: ["default"],
} as const;

/** `expect.poll` 的预算（对象形状，单独比）。 */
const EXPECT_POLL = { timeout: 4000, interval: 50 };

/**
 * 根 `test` **允许**出现的项（共享白名单）。`projects` 是分档本身，`coverage` 按文档只由根配置认，
 * 两者都**不是**要被两档继承的东西。新增根级项时先回答「它是共享的吗」：是就往 `SHARED_EXPECTATIONS`
 * 加，不是就往这里加并写清理由。
 */
const ROOT_ALLOWED_KEYS = new Set([
  "projects",
  "coverage",
  ...Object.keys(SHARED_EXPECTATIONS),
  "expect",
]);

/**
 * 期望分档：按目录声明的两档（§11.17），少一档 / 多一档都要有人解释。
 * ⚠️ DOM 档的 `name` 与 `environment` 是两个字段：前者是「这一档是谁」（也决定 `vitest list` 的
 * `[标签]`），后者是默认跑在哪个实现上（少数用例可用文件头 `// @vitest-environment jsdom` 改跑）；断言读后者。
 */
const EXPECTED_PROJECTS = ["happy-dom", "node"];

/**
 * 每档的**默认环境实现**（`environment`）。单独成表而不从档名推：写成 `name` 的副本，
 * 会让「给 DOM 档换实现（jsdom ⟷ happy-dom）」在不改判据的情况下直接通过 —— 而那正是
 * 本档最该被看一眼的改动（代价与保真度整档变化）。同 §11.17.1.2：两个字段各说各的。
 */
/* SAFETY: 类型断言已复核 */
const EXPECTED_TIER_ENVIRONMENTS = {
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
    const vitestRun = await resolvedVitest();
    expect(vitestRun.projects.map((p) => p.name).sort()).toEqual(EXPECTED_PROJECTS);
  });

  it("**每一档**都拿到了共享项（失效形态是一档落后，所以逐档判）", async () => {
    const vitestRun = await resolvedVitest();
    for (const project of vitestRun.projects) {
      /* SAFETY: 类型断言已复核 */
      const cfg = project.config as unknown as Record<string, unknown>;
      const prefix = `[${project.name}]`;
      // setupFiles 在解析后是**绝对路径**，所以比形状（落在仓库根之下、名字对）。
      /* SAFETY: 类型断言已复核 */
      const setupFiles = cfg.setupFiles as Array<string>;
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
      /* vitest 解析后把 `reporters` 归一成 `[名字, 选项?]` 元组数组 —— 按名字归一后比，
       * 否则这条判据红在「配置写法」而不是「这一档拿没拿到」（同 setupFiles 的归一口径）。 */
      /* SAFETY: 类型断言已复核 */
      const reporterEntries = cfg.reporters as Array<unknown>;
      const reporterNames = reporterEntries.map((entry) =>
        Array.isArray(entry) ? String(entry[0]) : String(entry),
      );
      expect(reporterNames, prefix).toEqual(SHARED_EXPECTATIONS.reporters);
      /* SAFETY: 类型断言已复核 */
      expect((cfg.expect as { poll?: unknown } | undefined)?.poll, prefix).toEqual(EXPECT_POLL);
    }
  });

  /**
   * `environment` 是这套分档里**唯一按档分叉**的项，所以它必须留在 project 内部。
   * 这一条判的是「它没被顺手抬到根上」—— 抬上去的表现是两档同环境，
   * 而 DOM 档下跑纯逻辑**不报错、只是变慢**（静默的那一侧，§11.17.1）。
   */
  it("`environment` 按档分叉，没被抬到根级共享（那正是分档要防的事）", async () => {
    const vitestRun = await resolvedVitest();
    const byName = new Map(vitestRun.projects.map((p) => [p.name, p.config]));
    for (const [name, env] of Object.entries(EXPECTED_TIER_ENVIRONMENTS)) {
      expect(byName.get(name)?.environment, `[${name}]`).toBe(env);
    }
  });

  it("没有一档写 `extends: false` 把自己摘出继承（例外要显式登记）", async () => {
    const vitestRun = await resolvedVitest();
    // `extends` 在解析后的配置上不会原样留名，改用它的**结果**判：
    // 关掉继承的那一档拿不到共享项 —— 由上面「逐档都拿到了」那一条兜住。
    // 这里只钉住「两档都不缺失」，并留一处源码级断言防住 `extends: false` 字样回来。
    const { readFile } = await import("node:fs/promises");
    const source = stripComments(await readFile(CONFIG, "utf8"));
    expect(source).not.toMatch(/extends\s*:\s*false/);
    for (const project of vitestRun.projects) {
      /* SAFETY: 类型断言已复核 */
      expect(
        (project.config as unknown as Record<string, unknown>).globals,
        `[${project.name}] 共享项缺席 = 这一档把继承关掉了`,
      ).toBe(SHARED_EXPECTATIONS.globals);
    }
  });

  it("根 `test` 上没有「只对某档有意义」的项，project 里不再重复声明共享项", async () => {
    // 这一条判**配置文本**（解析后看不出「它写在哪一层」），用 TS 模块直接读默认导出。
    /* SAFETY: 类型断言已复核 */
    const mod = (await import(path.join(ROOT, "vitest.config.ts"))) as {
      default: { test: Record<string, unknown> };
    };
    const rootTest = mod.default.test;
    const extra = Object.keys(rootTest).filter((k) => !ROOT_ALLOWED_KEYS.has(k));
    expect(extra, "新增根级项先回答「它是不是共享项」").toEqual([]);

    /**
     * **声明**在根上，不只是「解析出来的值恰好对」：`globals` 出厂值本就是 `false`，把根上的
     * `globals: false` 整行删掉，「逐档都拿到了」照样全绿。那一行是**文档**（写明不注入全局）
     * 而非行为；只按解析值判就等于允许它被顺手删掉。同 §11.17.1.2：同一件事只该有一个来源。
     */
    const declared = Object.keys(rootTest);
    for (const key of Object.keys(SHARED_EXPECTATIONS)) {
      expect(declared, `共享项 \`${key}\` 该声明在根 \`test\` 上`).toContain(key);
    }

    /* SAFETY: 类型断言已复核 */
    const projects = rootTest.projects as Array<{
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
 * 判据预算的**临时乘数**（ISSUE #2959）：既要买得到余量，又要收得回原状。它防两种腐化：
 * 把 `testTimeout` 直接改成 60_000（§13.6.4 禁止，没人知道何时收回）、放宽后日志里读不出。
 * 判四件：缺省 = 原值、乘数按上限截断并说出口、生效值落到解析后配置、`.cnb.yml` 那行是承重。
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
    const vitestRun = await resolvedVitest();
    const expected = resolveTimeoutBudget(process.env.COMFY_TEST_TIMEOUT_SCALE);
    for (const project of vitestRun.projects) {
      /* SAFETY: 类型断言已复核 */
      const cfg = project.config as unknown as Record<string, unknown>;
      expect(cfg.testTimeout, `[${project.name}]`).toBe(expected.testTimeout);
      expect(cfg.hookTimeout, `[${project.name}]`).toBe(expected.hookTimeout);
    }
  });

  it("`COMFY_TEST_TIMEOUT_SCALE` 若出现，必须是流水线级 env 里**唯一**的一行（那是「临时」的承重处）", () => {
    const text = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    const hits = text.split("\n").filter((line) => /^\s*COMFY_TEST_TIMEOUT_SCALE\s*:/.test(line));
    /* 两档合法形态（ISSUE #3489）：
     *   · 0 行 = 已收回（#2959 的 ×2 放宽按业主口径撤掉，缺省乘数 1 逐字等价原状）；
     *   · 1 行 = 又临时放宽了 —— 只许写在 `.common` 的 `env:` 里，写进某一格就只有那一格放宽。 */
    expect(
      hits.length,
      "这个键要么不出现（已收回），要么只在 `.common` 的 `env:` 里出现一次",
    ).toBeLessThanOrEqual(1);
    /* 值必须是「置着」的形态：空值 / 非数字 / 超过 3 都等于没放宽或放宽过头，
     * 而这两种在日志里只差一行 note。 */
    if (hits.length === 1) {
      expect(hits[0]).toMatch(/:\s*"?(?:1(?:\.\d+)?|2(?:\.\d+)?|3(?:\.\d+)?)"?\s*$/);
    }
  });
});
