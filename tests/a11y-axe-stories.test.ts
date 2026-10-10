// @vitest-environment jsdom
/**
 * a11y 自动化的**执行者**（台账 E6 第三格）：把 `src/components/ui/*.stories.tsx` 的每个故事
 * 在 jsdom 里逐个渲染，用 axe-core 判真实的无障碍违规。
 *
 * ── 它补的是哪一格 ─────────────────────────────────────────────
 *
 * 本仓早就有一道 a11y 判据（`scripts/check-a11y-rules.cjs`，规范 06 §6.12），但它判的是
 * **规则开关 ⇄ 台账**那一层：官方 recommended 有没有被悄悄关掉、方言与就地豁免登记全不全。
 * 那句话回答不了「界面**真的**违规了吗」—— 规则开着、代码照样能渲染出一枚没有名字的按钮。
 * 这一份就是那一半：**运行时**判，输入是 Storybook 的故事（本仓「全部已声明状态」的唯一出处，
 * 不另写夹具、不长出第二份组件清单）。
 *
 * ── 三条口径是实测逼出来的，别改回省事的那一档 ─────────────────
 *
 * ① **逐故事隔离**。第一版把 276 个故事全渲染进同一个 `document.body`、`cleanup()` 放在
 *    `afterEach`（它只在**整条用例**结束后跑一次），于是 axe 每跑一遍就把前面所有故事的问题
 *    重计一次，量出来 `region: 8566`、`button-name: 3587` —— 那**不是存量，是重复计数**。
 *    改成每个故事渲染 → 跑 axe → 立刻卸载之后，数字才是可以登记的。
 * ② **页面级规则显式关掉**。`region` / `landmark-*` 判的是「整页有没有唯一 main、标题层级对不对」，
 *    而这里渲染的是**一枚组件**，不是页面：裸挂进 body 时它必然报「内容不在 landmark 里」。
 *    那种红既不是缺陷也修不掉（要修的是测试构造），所以列进 `PAGE_SCOPE_RULES_OFF` 并写明理由；
 *    页面级的那一档真要做，落点在 e2e（台账 E3″ 现在连执行者都没有），不在这里。
 * ③ **渲染失败也要记账，不许默默跳过**。55 个故事需要 Storybook 的 decorator / provider
 *    （主题、表单上下文、路由），这一份给不了。把它们登记成 `unrenderable`：
 *    新增一个渲染不出来的故事 ⇒ 红；故事修好能渲了但登记还在 ⇒ 也红（双向不陈旧）。
 *    **不登记就等于「这格覆盖了 276 个故事」，而它其实漏了 55 个。**
 *
 * ── 名单怎么改 ─────────────────────────────────────────────
 *
 * 没有 `--update`：`scripts/.a11y-axe-known.json` 是要人读过并粘贴的**负债登记表**。
 * 判红时会打印一份逐字可粘的新清单（含每一条的组件文件、规则与命中节点数）。
 * 新增违规 ⇒ 红；修掉了却还留着登记 ⇒ 也红。
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import KNOWN from "../scripts/.a11y-axe-known.json";

type StoryModule = {
  default?: { title?: string; component?: unknown };
} & Record<string, unknown>;

type Finding = { component: string; rule: string; nodes: number };

const files = import.meta.glob("../src/components/ui/*.stories.tsx", {
  eager: true,
}) as Record<string, StoryModule>;

/** 页面级规则：判的是「一整页」，对单枚裸渲染的组件没有意义（见文件头第 ② 条）。 */
const PAGE_SCOPE_RULES_OFF = [
  "region",
  "landmark-one-main",
  "landmark-unique",
  "landmark-no-duplicate-banner",
  "form-field-multiple-labels",
];

/** 组件文件（`button.tsx`）—— 登记的键用它，不随故事数量漂。 */
function componentOf(storyFile: string): string {
  return `${storyFile.replace("../src/components/ui/", "").replace(".stories.tsx", "")}.tsx`;
}

/** 一份逐字可粘的清单（判红时必须打印它 —— 红话要给得出下一步）。 */
function asLedger(findings: Finding[], unrenderable: string[]): string {
  const byPair = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.component}|${f.rule}`;
    const prev = byPair.get(key);
    byPair.set(key, { ...f, nodes: (prev?.nodes ?? 0) + f.nodes });
  }
  return JSON.stringify(
    {
      violations: [...byPair.values()]
        .sort((a, b) =>
          `${a.component}|${a.rule}`.localeCompare(`${b.component}|${b.rule}`),
        )
        .map((f) => ({ component: f.component, rule: f.rule, nodes: f.nodes })),
      unrenderable: [...new Set(unrenderable)].sort(),
    },
    null,
    2,
  );
}

describe("a11y 自动化：ui 基元的每个故事过 axe", () => {
  it("违规清单与 unrenderable 清单与登记表逐字一致（双向不陈旧）", async () => {
    const findings: Finding[] = [];
    const unrenderable: string[] = [];
    let rendered = 0;

    for (const [path, mod] of Object.entries(files)) {
      const component = componentOf(path);
      const Comp = mod.default?.component;
      if (typeof Comp !== "function" && typeof Comp !== "object") {
        unrenderable.push(`${component} (meta.component 不是组件)`);
        continue;
      }
      for (const [storyName, raw] of Object.entries(mod)) {
        if (storyName === "default") continue;
        const story = raw as { args?: Record<string, unknown> };
        if (!story || typeof story !== "object") continue;
        /* 每个故事一趟：渲染 → 判 → **立刻卸载**。放在 afterEach 里做等于没做
         * （见文件头第 ① 条，那一次的假存量比这份名单大两个数量级）。 */
        let view: ReturnType<typeof render> | null = null;
        try {
          view = render(
            createElement(
              Comp as React.ComponentType<Record<string, unknown>>,
              story.args ?? {},
            ),
          );
          const results = await axe.run(view.baseElement, {
            resultTypes: ["violations"],
            rules: Object.fromEntries(
              PAGE_SCOPE_RULES_OFF.map((rule) => [rule, { enabled: false }]),
            ),
          });
          rendered += 1;
          for (const violation of results.violations) {
            findings.push({
              component,
              rule: violation.id,
              nodes: violation.nodes.length,
            });
          }
        } catch (error) {
          /* 只登「组件 > 故事」这一层，**不带错误文本**：错误文案会随实现改动，
           * 把它写进登记表会让这条账每次改文案都 stale 一次（红在一次措辞上）。
           * 要查原因去本地跑，登记表只承担「这一档覆盖不到它」这一件事。 */
          void error;
          unrenderable.push(`${component} > ${storyName}`);
        } finally {
          view?.unmount();
          cleanup();
        }
      }
    }

    /* 判据本身不许「读不到就当过」：故事面为空 ⇒ 枚举坏了（glob 路径、目录改名），
       这与「真的没有违规」是两件事 —— 前者必须红（§11.23「判据在场 ≠ 判据在跑」）。 */
    expect(
      rendered,
      `枚举到的故事渲染成功数为 ${rendered}（文件 ${Object.keys(files).length} 份）—— 为零说明这一档根本没在跑`,
    ).toBeGreaterThan(0);

    const actual = asLedger(findings, unrenderable);
    const registered = asLedger(
      (KNOWN.violations as Finding[]).map((v) => ({ ...v, nodes: 0 })),
      KNOWN.unrenderable,
    );
    const actualPairs = JSON.parse(actual) as {
      violations: { component: string; rule: string }[];
      unrenderable: string[];
    };
    const registeredPairs = JSON.parse(registered) as typeof actualPairs;

    const found = new Set(
      actualPairs.violations.map((v) => `${v.component}|${v.rule}`),
    );
    const registeredSet = new Set(
      registeredPairs.violations.map((v) => `${v.component}|${v.rule}`),
    );
    const newViolations = [...found].filter((p) => !registeredSet.has(p));
    const stale = [...registeredSet].filter((p) => !found.has(p));

    /* 不一致时把**候选清单**落到系统临时目录（不是仓库、更不是登记表本身）：
     * 登记表的更新方式是「人读过再粘贴」，判据自己不许有「跑一下就绿」的出口
     * —— 这份文件只是省掉「从终端输出里刮 JSON」那一步（刮出来的东西不可靠）。 */
    if (newViolations.length > 0 || stale.length > 0) {
      const os = await import("node:os");
      const fse = await import("node:fs");
      fse.writeFileSync(
        os.tmpdir() + "/a11y-axe-candidate.json",
        actual + "\n",
        "utf8",
      );
    }

    expect(
      {
        newViolations,
        stale,
        unrenderableDelta:
          actualPairs.unrenderable.length - registeredPairs.unrenderable.length,
      },
      `a11y 违规名单与登记表不一致 —— 可逐字粘贴的新名单：\n${actual}`,
    ).toEqual({ newViolations: [], stale: [], unrenderableDelta: 0 });
  }, 600_000);
});
