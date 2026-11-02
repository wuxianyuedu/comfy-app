// @vitest-environment jsdom
/**
 * a11y 自动化的**执行者**（台账 E6 第三格）：把 `src/components/ui/*.stories.tsx` 的每个故事
 * 按 Storybook 的语义渲染，在 jsdom 里跑 axe-core，判真实的无障碍违规。
 *
 * ── 它补的是哪一格 ─────────────────────────────────────────────
 *
 * 本仓早就有一道 a11y 判据（`scripts/check-a11y-rules.cjs`，规范 06 §6.12），但它判的是
 * **规则开关 ⇄ 台账**那一层：官方 recommended 有没有被悄悄关掉、方言与就地豁免登记全不全。
 * 那句话回答不了「界面**真的**违规了吗」—— 规则开着、代码照样能渲染出一枚没有名字的按钮。
 * 这一份就是那一半：**运行时**判，输入是 Storybook 的故事（本仓「全部已声明状态」的唯一出处，
 * 不另写夹具、不长出第二份组件清单）。
 *
 * ── 五条口径是实测逼出来的，别改回省事的那一档 ─────────────────
 *
 * ① **逐故事隔离**。第一版把 276 个故事全渲染进同一个 `document.body`、`cleanup()` 放在
 *    `afterEach`（它只在**整条用例**结束后跑一次），于是 axe 每跑一遍就把前面所有故事的问题
 *    重计一次，量出来 `region: 8566`、`button-name: 3587` —— 那**不是存量，是重复计数**。
 *    改成每个故事渲染 → 跑 axe → 立刻卸载之后，数字才是可以登记的。
 * ② **页面级规则显式关掉**。`region` / `landmark-*` 判的是「整页有没有唯一 main、标题层级对不对」，
 *    而这里渲染的是**一枚组件**，不是页面：裸挂进 body 时它必然报「内容不在 landmark 里」。
 *    那种红既不是缺陷也修不掉（要修的是测试构造），所以列进 `PAGE_SCOPE_RULES_OFF` 并写明理由；
 *    页面级的那一档真要做，落点在 e2e（台账 E3″ 现在连执行者都没有），不在这里。
 * ③ **渲不出来也要记账，不许默默跳过**。故事渲染抛错、或 `render` 不返回节点时，
 *    把它们登记成 `unrenderable`：新增一个渲染不出来的故事 ⇒ 红；故事修好能渲了但登记
 *    还在 ⇒ 也红（双向不陈旧）。原因**只打印不进账**（错误文案会随实现漂）。
 *    **不登记就等于在说「这一档把所有故事都判过了」，而它其实漏了一批。**
 * ④ **渲染按 Storybook 的语义来**：`story.render ?? meta.render`，两者都没有才退回
 *    `<Component {...args} />`；args 是 `{ ...meta.args, ...story.args }` 的**浅合并**。
 *    这两条不是「更讲究一点」，是第一版把两者都写错了，代价是**假覆盖 + 假噪音**两样：
 *    故事里的 `render:` 被整个忽略、直接拿 `meta.component` 配 `story.args` 去渲，
 *    于是 `Default: Story = {}` 这种「输入全在 meta 上」的故事拿到空 props（`unrenderable`
 *    名单里很大一块是这个原因，不是「需要 provider」），而 `ui/slider` 这种「受控 `value`
 *    由 `render` 用 `defaultValue` 补上」的故事拿到 `value=undefined`
 *    ⇒ base-ui 的 `clamp(undefined, 0, 100)` 算出 `NaN` ⇒ React 打
 *    `Received NaN for the value attribute`。那两行噪音**不是缺陷**，是这一档在渲一个
 *    Storybook 里并不存在的形态。浅合并的形状抄自 Storybook 自己的 `prepareStory`
 *    （`{...project.args, ...meta.args, ...story.args}`）；它还会把 `argTypes[x].defaultValue`
 *    折进 args —— 那一档本仓为空，由下面 `argTypeDefaultHits` 那条判据正面盯着，
 *    不是「假设它一直为空」。
 * ⑤ **要真实绘制的规则不许让 jsdom 判**（`PAINT_SCOPE_RULES_OFF`）。jsdom 没有字体度量、
 *    没有伪元素的 computed style、`getBoundingClientRect` 恒为 0，而这一档也不注入应用的
 *    样式表 ⇒ 本仓的 Tailwind class 在这棵树里不出现在 computed style 上（这两条前提之一
 *    由下面 `cssProbe` 那一格正面判，不写在注释里相信）。让 axe 带着这些缺口去判
 *    颜色对比，结果是 `incomplete`（本用例只收 `violations`，`incomplete` 被丢掉）——
 *    也就是**结构性的假通过**，外加两条 `Not implemented` 噪音。规则关掉、理由逐条写在
 *    常量上；噪音那一层的处置（精确白名单 + 计数 + 其余原样转发）在
 *    `tests/helpers/jsdom-capability.ts`，接线在 `tests/setup.ts`。
 *
 * ── 名单怎么改 ─────────────────────────────────────────────
 *
 * 没有 `--update`：`scripts/.a11y-axe-known.json` 是要人读过并粘贴的**负债登记表**。
 * 判红时会打印一份逐字可粘的新清单（含每一条的组件文件、规则与命中节点数），
 * 并附每个 `unrenderable` 的**当轮失败原因**（原因只打印，不进登记表 —— 错误文案会随实现漂，
 * 把它写进账里等于每次改文案都 stale 一次）。
 * 新增违规 ⇒ 红；修掉了却还留着登记 ⇒ 也红。
 */
import { cleanup, render } from "@testing-library/react";
import { createElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import KNOWN from "../scripts/.a11y-axe-known.json";

import { installJsdomCapabilityGate } from "./helpers/jsdom-capability";

type Finding = { component: string; nodes: number; rule: string };

/** 一个故事的渲染函数（CSF3 的 `render`：吃 args、出节点）。 */
type StoryFn = (args: Record<string, unknown>) => ReactNode;

type ArgTypes = Record<string, { defaultValue?: unknown } | undefined>;

type MetaShape = {
  args?: Record<string, unknown>;
  argTypes?: ArgTypes;
  component?: unknown;
  render?: StoryFn;
  title?: string;
};

type StoryShape = {
  args?: Record<string, unknown>;
  argTypes?: ArgTypes;
  render?: StoryFn;
};

type StoryModule = { default?: MetaShape } & Record<string, unknown>;

/* 断言**不直接挂在泛型调用上**：`@typescript-eslint/no-unnecessary-type-assertion`
 * 会认「泛型调用的类型实参可从断言推断」，要求把类型写进 `glob<…>`（而这份 glob 的
 * 泛型签名随 vite 版本变，写进去反而脆）。先落到变量再断言，形状不变、也不触发那条规则。 */
const globbed = import.meta.glob("../src/components/ui/*.stories.tsx", {
  eager: true,
});
/* SAFETY: 类型断言已复核 */
const files = globbed as Record<string, StoryModule>;

/** 页面级规则：判的是「一整页」，对单枚裸渲染的组件没有意义（见文件头第 ② 条）。 */
const PAGE_SCOPE_RULES_OFF = [
  "region",
  "landmark-one-main",
  "landmark-unique",
  "landmark-no-duplicate-banner",
  "form-field-multiple-labels",
];

/**
 * 需要**真实绘制**的规则：jsdom 给不了它们要的事实，硬判的结果是「探测失败 ⇒
 * `incomplete` ⇒ 本用例按 `violations` 收时恰好丢掉」这种假通过（见文件头第 ⑤ 条）。
 * 逐条理由（调用点按 axe-core 4.x 的源码点名，规则改名/拆分时这三行要跟着重核）：
 *
 * - `color-contrast`：`matches` 经 `hasRealTextChildren` → `_isIconLigature` 要 canvas
 *   度量；`evaluate` 经 `getPseudoElementArea` 要伪元素 `content`、经
 *   `boundingClientRect` 算背景覆盖面积 —— 三样在 jsdom 里分别是 `null`、
 *   not-implemented、恒 0。且 vitest 默认 `css: false`，前景/背景色压根没进
 *   computed style，这一格在 jsdom 里从来没有过判点。
 * - `label-content-name-mismatch`：比对可见文本与无障碍名时显式传
 *   `visibleVirtual({ ignoreIconLigature: true, pixelThreshold })`，前者要 canvas，
 *   后者是像素阈值 —— 都是绘制事实。
 * - `link-in-text-block`：`hasPseudoContent` 要 `getComputedStyle(node, "::before")`，
 *   `isBlock` 要真实 `display`。
 *
 * ⚠️ 关掉不等于覆盖到了。落点说清楚：这三条要**真浏览器 + 生效的 CSS**，
 * 本仓那一档的执行者是 Storybook 的 a11y 面板（`@storybook/addon-a11y`，同一个
 * axe-core 在真浏览器里跑）—— 它是**人现场看某一棵树**的，不是机器判据。
 * 「绘制层的 a11y 有没有机器执行者」这一格仍按空记在台账 E6，不在这里冒充。
 */
const PAINT_SCOPE_RULES_OFF = [
  "color-contrast",
  "label-content-name-mismatch",
  "link-in-text-block",
];

const RULES_OFF = [...PAGE_SCOPE_RULES_OFF, ...PAINT_SCOPE_RULES_OFF];

/** 组件文件（`button.tsx`）—— 登记的键用它，不随故事数量漂。 */
function componentOf(storyFile: string): string {
  return `${storyFile.replace("../src/components/ui/", "").replace(".stories.tsx", "")}.tsx`;
}

/** 一条失败原因压成一行（登记表不存它，只打印给人看 —— 见文件头第 ③ 条与「名单怎么改」）。 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error).slice(0, 200);
  }
  /* 只给 `error.message` 常常是「Cannot read properties of undefined」这种指不出位置的话，
   * 而栈里第一个**指向 ui 组件文件**的帧恰好就是那一处。Windows 的栈用反斜杠，先归一。 */
  const frame = error.stack
    ?.split("\n")
    .map((l) => l.replaceAll("\\", "/"))
    .find((l) => l.includes("src/components/ui/"));
  return (frame ? `${error.message} ← ${frame.trim()}` : error.message).slice(0, 200);
}

/** 一份逐字可粘的清单（判红时必须打印它 —— 红话要给得出下一步）。 */
function asLedger(findings: Array<Finding>, unrenderable: Array<string>): string {
  const byPair = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.component}|${f.rule}`;
    const prev = byPair.get(key);
    byPair.set(key, { ...f, nodes: (prev?.nodes ?? 0) + f.nodes });
  }
  return JSON.stringify(
    {
      violations: [...byPair.values()]
        .sort((a, b) => `${a.component}|${a.rule}`.localeCompare(`${b.component}|${b.rule}`))
        .map((f) => ({ component: f.component, rule: f.rule, nodes: f.nodes })),
      unrenderable: [...new Set(unrenderable)].sort(),
    },
    null,
    2,
  );
}

describe("a11y 自动化：ui 基元的每个故事过 axe", () => {
  it("违规清单与 unrenderable 清单与登记表逐字一致（双向不陈旧）", async () => {
    /* 能力缺口的处置器必须在场。它由 `tests/setup.ts` 接线，这里断言的是「接线没断」：
     * vitest 若改了 jsdom 实例的挂载形状，`installJsdomCapabilityGate` 会静默回 null，
     * 那两行 `Not implemented` 就回来了 —— 而回来之后的形态与「本来就没噪音」同形。 */
    const capability = installJsdomCapabilityGate(globalThis);
    expect(capability, "jsdom 能力缺口的处置器没接上（见 tests/setup.ts）").not.toBeNull();
    /* 关掉的规则名必须**真的是 axe 里的规则**。打错一个字母的那一档，`axe.run` 会在
     * 每个故事上各抛一次「Rule not found」——几百条红看起来像「渲染面坏了」，
     * 而病灶是一个字符串。这里一次判掉（`RULES_OFF` = 页面级 + 绘制层两组，都覆盖）。 */
    const axeRuleIds = new Set(axe.getRules().map((rule) => rule.ruleId));
    expect(
      RULES_OFF.filter((rule) => !axeRuleIds.has(rule)),
      "RULES_OFF 里有点不出名的规则（打错字，或 axe 升级后改了名）",
    ).toEqual([]);
    /* 第 ⑤ 条的前提要被判出来，不是写在注释里相信：这一档不注入应用的样式表，
     * 所以 `text-white` / `bg-black` 落不进 computed style —— `color-contrast` 在这里
     * **从来没有判点**。哪天环境变了（有人把 CSS 注入打开），这一格先红，
     * 而那时该做的事是把上面那三条重新打开，不是把红压下去。 */
    const cssProbe = document.createElement("div");
    cssProbe.className = "text-white bg-black";
    document.body.append(cssProbe);
    const probeColor = window.getComputedStyle(cssProbe).color;
    cssProbe.remove();
    expect(
      probeColor,
      `探针拿到了 ${probeColor || "（空）"} —— 环境的 CSS 现在生效了，第 ⑤ 条的前提变了：重算 PAINT_SCOPE_RULES_OFF 那三条还该不该关着`,
    ).not.toBe("rgb(255, 255, 255)");

    const findings: Array<Finding> = [];
    /* 每条**新**违规留一个命中节点的 HTML（只第一条、截断）。登记表里只有
     * `(组件, 规则, 节点数)`，那三样不足以回答「凭什么报我」—— 而这一档最常见的
     * 争议正是「这是组件的缺陷，还是这一档渲出来的形态」。有了节点原文，
     * 定性不必再跑一遍去加探针。 */
    const nodeSamples = new Map<string, string>();
    const unrenderable: Array<string> = [];
    const reasons = new Map<string, string>();
    const argTypeDefaultHits: Array<string> = [];
    let rendered = 0;

    for (const [path, mod] of Object.entries(files)) {
      const component = componentOf(path);
      const meta: MetaShape = mod.default ?? {};
      const Comp = meta.component;
      for (const [storyName, raw] of Object.entries(mod)) {
        if (storyName === "default") {
          continue;
        }
        if (!raw || typeof raw !== "object") {
          continue;
        }
        /* SAFETY: 类型断言已复核 */
        const story = raw as StoryShape;
        const key = `${component} > ${storyName}`;
        /* `argTypes[x].defaultValue` 在 Storybook 里由 argsEnhancers 折进 args。
         * 本用例的浅合并与它等价的前提是这一档为空 —— 出现了就是「渲的输入与
         * Storybook 不同」，当场红而不是让它变成一个安静的差别。 */
        for (const [argName, def] of Object.entries({
          ...meta.argTypes,
          ...story.argTypes,
        })) {
          if (def && "defaultValue" in def) {
            argTypeDefaultHits.push(`${key} > ${argName}`);
          }
        }
        const args = { ...meta.args, ...story.args };
        const renderFn =
          typeof story.render === "function"
            ? story.render
            : typeof meta.render === "function"
              ? meta.render
              : undefined;
        /* 每个故事一趟：渲染 → 判 → **立刻卸载**。放在 afterEach 里做等于没做
         * （见文件头第 ① 条，那一次的假存量比这份名单大两个数量级）。 */
        let view: ReturnType<typeof render> | null = null;
        try {
          let tree: ReactNode;
          if (renderFn) {
            tree = renderFn(args);
          } else if (
            typeof Comp === "function" ||
            typeof Comp === "object" /* forwardRef / memo 包装 */
          ) {
            /* SAFETY: 类型断言已复核 */
            tree = createElement(Comp as ComponentType<Record<string, unknown>>, args);
          } else {
            throw new Error("故事没有 render，meta.component 也不是组件");
          }
          /* Storybook 允许「副作用式 render」（不返回节点、直接改 DOM），也允许
           * `cond && <X/>` 这种渲成 `false` 的形状。这一档给不出那种画面时的正确说法是
           * **渲染不了**，而不是渲一棵空树让 axe 判通过 —— 空树的判定结果永远是「零违规」。 */
          if (tree === null || tree === undefined || tree === false || tree === "") {
            throw new Error("render 未返回可判的节点（副作用式 / 空 render）");
          }
          /* SAFETY: 类型断言已复核 */
          view = render(tree as ReactElement);
          const results = await axe.run(view.baseElement, {
            resultTypes: ["violations"],
            rules: Object.fromEntries(RULES_OFF.map((rule) => [rule, { enabled: false }])),
          });
          rendered += 1;
          for (const violation of results.violations) {
            findings.push({
              component,
              rule: violation.id,
              nodes: violation.nodes.length,
            });
            const pair = `${component}|${violation.id}`;
            if (!nodeSamples.has(pair)) {
              const first = violation.nodes[0];
              /* `node.html` 会被 axe 自己在长属性处截断（实测 `class="border-input focus-v..."`），
               * 光看它答不出「凭什么报我」；`failureSummary` 才是那半句 —— 它直接说
               * 「缺的是可见文本 / 缺 aria-label / 需要的子角色没渲染」。两个都留。 */
              nodeSamples.set(
                pair,
                `${first?.failureSummary ?? "?"} ⟵ ${first?.target?.join(" ") ?? "?"}`.slice(
                  0,
                  300,
                ),
              );
            }
          }
        } catch (error) {
          /* 键里**不带错误文本**（见第 ③ 条）：登记表只承担「这一档覆盖不到它」这一件事。
           * 原因收在 `reasons` 里，判红时随消息打出来。 */
          unrenderable.push(key);
          reasons.set(key, reasonOf(error));
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

    expect(
      argTypeDefaultHits,
      `argTypes 里出现了 defaultValue（${argTypeDefaultHits.join("、")}）—— Storybook 会把它折进 args，而本用例按「{...meta.args, ...story.args}」浅合并。先把它折进合并再登记，别拿与 Storybook 不同的输入判 a11y。`,
    ).toEqual([]);

    const actual = asLedger(findings, unrenderable);
    /* SAFETY: 类型断言已复核 */
    const registered = asLedger(
      (KNOWN.violations as Array<Finding>).map((v) => ({
        ...v,
        nodes: 0,
      })),
      KNOWN.unrenderable,
    );
    /* SAFETY: 类型断言已复核 */
    const actualPairs = JSON.parse(actual) as {
      unrenderable: Array<string>;
      violations: Array<{ component: string; rule: string }>;
    };
    /* SAFETY: 类型断言已复核 */
    const registeredPairs = JSON.parse(registered) as typeof actualPairs;

    const found = new Set(actualPairs.violations.map((v) => `${v.component}|${v.rule}`));
    const registeredSet = new Set(
      registeredPairs.violations.map((v) => `${v.component}|${v.rule}`),
    );
    const newViolations = [...found].filter((p) => !registeredSet.has(p));
    const stale = [...registeredSet].filter((p) => !found.has(p));
    /* 渲染结果的差量**逐条**列出来（业主口径：这份名单会变，要一条一条读过再改账，
     * 不许顺手覆盖）。只给一个 delta 数字会让人直接粘贴 —— 而每一条的进出都是一次覆盖面的变化。 */
    const actualUnrenderable = new Set(actualPairs.unrenderable);
    const registeredUnrenderable = new Set(registeredPairs.unrenderable);
    const unrenderableGained = [...actualUnrenderable].filter(
      (k) => !registeredUnrenderable.has(k),
    );
    const unrenderableLost = [...registeredUnrenderable].filter((k) => !actualUnrenderable.has(k));

    /* 不一致时把**候选清单**落到系统临时目录（不是仓库、更不是登记表本身）：
     * 登记表的更新方式是「人读过再粘贴」，判据自己不许有「跑一下就绿」的出口
     * —— 这份文件只是省掉「从终端输出里刮 JSON」那一步（刮出来的东西不可靠）。 */
    if (
      newViolations.length > 0 ||
      stale.length > 0 ||
      unrenderableGained.length > 0 ||
      unrenderableLost.length > 0
    ) {
      const os = await import("node:os");
      const fse = await import("node:fs");
      fse.writeFileSync(`${os.tmpdir()}/a11y-axe-candidate.json`, `${actual}\n`, "utf8");
    }

    const gapLines = capability?.summaryLines() ?? [];
    expect(
      {
        newViolations,
        stale,
        unrenderableGained,
        unrenderableLost,
      },
      [
        `a11y 名单与登记表不一致。可逐字粘贴的新清单：\n${actual}`,
        newViolations.length > 0
          ? `新出现的违规（附第一个命中节点的原文，用来分「组件的缺陷」与「这一档渲出来的形态」）：\n${newViolations
              .map((p) => `  · ${p} —— ${nodeSamples.get(p) ?? "?"}`)
              .join("\n")}`
          : "",
        stale.length > 0
          ? `登记里已经不再命中的（修好了就该撤账）：\n${stale.map((p) => `  · ${p}`).join("\n")}`
          : "",
        unrenderableGained.length > 0
          ? `当轮渲不出来的（逐条原因，账里不存它）：\n${unrenderableGained
              .map((k) => `  · ${k} —— ${reasons.get(k) ?? "?"}`)
              .join("\n")}`
          : "",
        unrenderableLost.length > 0
          ? `当轮**渲得出来了**、登记该撤的（覆盖面变大了，不是坏消息）：\n${unrenderableLost
              .map((k) => `  · ${k}`)
              .join("\n")}`
          : "",
        gapLines.length > 0
          ? `本轮 jsdom 能力缺口的条数（确认「安静」是白名单在管，不是判据没跑）：\n${gapLines.join("\n")}`
          : "",
      ]
        .filter((l) => l !== "")
        .join("\n\n"),
    ).toEqual({
      newViolations: [],
      stale: [],
      unrenderableGained: [],
      unrenderableLost: [],
    });
  }, 600_000);
});
