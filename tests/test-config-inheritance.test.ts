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
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVitest, type Vitest } from "vitest/node";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(ROOT, "vitest.config.ts");

/**
 * 共享项 ⇒ 期望值。**这就是「一处定义」的那张表**：
 * 新增一项根级共享项时，同批加在这里（否则第 4 条会红 —— 那正是它的用意）。
 */
const SHARED_EXPECTATIONS = {
  setupFiles: ["tests/setup.ts"],
  globals: false,
  testTimeout: 30_000,
  hookTimeout: 45_000,
  maxWorkers: 8,
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

/** 期望分档：按目录声明的两档（§11.17），少一档 / 多一档都要有人解释。 */
const EXPECTED_PROJECTS = ["jsdom", "node"];

/** 解析一次就够 —— `createVitest()` 实测 ~260ms，且它只建配置不起 worker。 */
let cached: Vitest | undefined;
async function resolvedVitest(): Promise<Vitest> {
  cached ??= await createVitest("test", { run: true, config: CONFIG });
  return cached;
}

describe("根 `test` 的共享项落到两个 project 上（§11.17.3）", () => {
  it("两档都在，且命名与文档一致", async () => {
    const vitest = await resolvedVitest();
    expect(vitest.projects.map((p) => p.name).sort()).toEqual(
      EXPECTED_PROJECTS,
    );
  });

  it("**每一档**都拿到了共享项（失效形态是一档落后，所以逐档判）", async () => {
    const vitest = await resolvedVitest();
    for (const project of vitest.projects) {
      const cfg = project.config as unknown as Record<string, unknown>;
      const prefix = `[${project.name}]`;
      // setupFiles 在解析后是**绝对路径**，所以比形状（落在为仓库根之下、名字对）。
      const setupFiles = cfg.setupFiles as string[];
      expect(setupFiles.map((f) => path.relative(ROOT, f)), prefix).toEqual(
        SHARED_EXPECTATIONS.setupFiles,
      );
      expect(cfg.globals, prefix).toBe(SHARED_EXPECTATIONS.globals);
      expect(cfg.testTimeout, prefix).toBe(SHARED_EXPECTATIONS.testTimeout);
      expect(cfg.hookTimeout, prefix).toBe(SHARED_EXPECTATIONS.hookTimeout);
      expect(cfg.maxWorkers, prefix).toBe(SHARED_EXPECTATIONS.maxWorkers);
      expect(
        (cfg.expect as { poll?: unknown } | undefined)?.poll,
        prefix,
      ).toEqual(EXPECT_POLL);
    }
  });

  /**
   * `environment` 是这套分档里**唯一按档分叉**的项，所以它必须留在 project 内部。
   * 这一条判的是「它没被顺手抬到根上」—— 抬上去的表现是两档同环境，
   * 而 jsdom 档下跑纯逻辑**不报错、只是变慢**（静默的那一侧，§11.17.1）。
   */
  it("`environment` 按档分叉，没被抬到根级共享（那正是分档要防的事）", async () => {
    const vitest = await resolvedVitest();
    const byName = new Map(vitest.projects.map((p) => [p.name, p.config]));
    expect(byName.get("node")?.environment).toBe("node");
    expect(byName.get("jsdom")?.environment).toBe("jsdom");
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
        (project.config as unknown as Record<string, unknown>).globals,
        `[${project.name}] 共享项缺席 = 这一档把继承关掉了`,
      ).toBe(SHARED_EXPECTATIONS.globals);
    }
  });

  it("根 `test` 上没有「只对某档有意义」的项，project 里不再重复声明共享项", async () => {
    // 这一条判**配置文本**（解析后看不出「它写在哪一层」），用 TS 模块直接读默认导出。
    const mod = (await import(path.join(ROOT, "vitest.config.ts"))) as {
      default: { test: Record<string, unknown> };
    };
    const rootTest = mod.default.test;
    const extra = Object.keys(rootTest).filter(
      (k) => !ROOT_ALLOWED_KEYS.has(k),
    );
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
      expect(declared, `共享项 \`${key}\` 该声明在根 \`test\` 上`).toContain(
        key,
      );
    }

    const projects = rootTest.projects as {
      test: Record<string, unknown> & { name?: string };
    }[];
    for (const entry of projects) {
      const duplicated = Object.keys(entry.test).filter((k) =>
        Object.keys(SHARED_EXPECTATIONS).includes(k),
      );
      expect(
        duplicated,
        `[${String(entry.test.name)}] 共享项该只在根 \`test\` 上定义一次`,
      ).toEqual([]);
    }
  });
});
