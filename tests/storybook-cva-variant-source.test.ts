/**
 * 故事文件的**枚举来源**判据（ISSUE #1381 续）。
 *
 * 为什么需要它：`cva()` 返回的是一个 `(props?) => string` 的**函数**，
 * `.variants` 只存在于 TS 泛型里、运行时并没有。于是
 * `Object.keys(buttonVariants.variants.variant)` 这种「从 cva 返回值上取候选」
 * 的写法有两个失败面，而两者**都不在同一处报错**：
 *
 *  · `tsc` 会红（类型上没有 `.variants`）—— 但只在跑过 tsc 的地方红；
 *  · Storybook 在**加载期**抛 `Cannot read properties of undefined` ——
 *    表现是「侧栏里列着这个组件的故事、画布上一片空白」，与「这个 story 挂了」
 *    的直觉对不上，首轮的 3 份 story 就是这么写的。
 *
 * `tests/storybook-config.test.ts` 守的是**配置**契约（glob / 样式 / 主题 /
 * 启动器），对「故事文件自己怎么写」无感 —— 本条补的就是那一格。
 *
 * 四条判据（只读文本与 AST，不起子进程）：
 *  1. **别从 cva 的返回值上取枚举** —— 基底按 `cva` 的**绑定名**判，
 *     不按 `xxxVariants` 这个名字：改名就能绕过的门禁等于没有。
 *  2. **手写的候选清单不许漏档** —— 正确写法（从 props 派生）拿不到运行时枚举，
 *     枚举值必须手写一份，于是「`cva` 里新加一档、故事没跟上」是这条账的日常
 *     失效形态。轴的链接走 `argTypes` 的 `options`，不靠命名约定猜。
 *  3. **`argTypes` 的 `options` 指向文件里真有的清单**（拼错名字 = 下拉空着，
 *     而 Storybook 不会为此报错）。
 *  4. **组件的每个变体轴，故事里都列出来了**（整条轴被漏掉 = 那一档没人验）。
 *
 * 已知边界（写清，别当成已完成）：只覆盖 `cva` 调用里 `variants` 那一层的
 * **字面量** key。`variants` 由外部常量拼出来、或轴名是计算属性时，本条读不到
 * —— 那类写法在 `ui/` 里当前为 0（判据报「轴数为 0」即跳过，不会假装通过）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  controlOptionsByAxis,
  cvaVariantAxes,
  cvaVariantKeys,
  derivedAxisNames,
  findCvaVariantAccess,
  literalArray,
} from "../scripts/storybook-checks/cva-variant-source.mjs";

const ROOT = resolve(".");
const COMPONENTS = join(ROOT, "src", "components");

/** 递归收集 `*.stories.tsx`（不只看 `ui/`：故事的后继落点可能在业务目录）。 */
function collectStories(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      collectStories(full, out);
    } else if (entry.name.endsWith(".stories.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const STORIES = collectStories(COMPONENTS).sort();

/** 故事同目录的组件源码（`badge.stories.tsx` → `badge.tsx`，再试 `.ts`）。 */
function componentSourceOf(story: string): string | null {
  const base = story.replace(/\.stories\.tsx$/, "");
  for (const ext of [".tsx", ".ts"]) {
    const cand = base + ext;
    try {
      readFileSync(cand);
      return cand;
    } catch {
      /* 换下一个扩展名 */
    }
  }
  return null;
}

function parse(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** 有对应组件源码、且组件真的用 cva 定义了变体轴的那批故事。 */
const PAIRABLE = STORIES.flatMap((story) => {
  const component = componentSourceOf(story);
  if (component === null) return [];
  const axes = [...cvaVariantAxes(parse(component)).keys()];
  return axes.length === 0 ? [] : [{ story, component, axes }];
});

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

describe("故事文件的枚举来源（ISSUE #1381）", () => {
  it("stories glob 能扫到的故事文件不为空（空集 = 判据在空转）", () => {
    expect(STORIES.length).toBeGreaterThan(0);
  });

  it("没有任何一份 story 从 cva 的返回值上取变体表", () => {
    const offenders: string[] = [];
    for (const story of STORIES) {
      for (const hit of findCvaVariantAccess(parse(story))) {
        offenders.push(`${rel(story)}:${hit.line} → ${hit.text}`);
      }
    }
    expect(
      offenders,
      "cva() 返回的是函数，运行时没有 `.variants`：tsc 会红，Storybook 在加载期抛 " +
        "`Cannot read properties of undefined`（侧栏有故事、画布一片空白）。" +
        '改成从 props 派生：NonNullable<React.ComponentProps<typeof C>["轴"]>',
    ).toEqual([]);
  });

  it("argTypes 的 options 指向的清单在文件里真的存在", () => {
    const offenders: string[] = [];
    for (const story of STORIES) {
      const source = parse(story);
      const declared = new Set(
        source.statements.flatMap((stmt) =>
          ts.isVariableStatement(stmt)
            ? stmt.declarationList.declarations
                .filter((d) => ts.isIdentifier(d.name))
                .map((d) => (d.name as ts.Identifier).text)
            : [],
        ),
      );
      for (const [axis, arrayName] of controlOptionsByAxis(source)) {
        if (!declared.has(arrayName)) {
          offenders.push(
            `${rel(story)} → argTypes.${axis}.options: ${arrayName}（文件里没有这个声明）`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("组件的每个变体轴在故事里都有候选清单（整条轴漏掉 = 那一档没人验）", () => {
    expect(PAIRABLE.length, "一条都没比对到 = 判据在空转").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { story, component, axes } of PAIRABLE) {
      const refs = controlOptionsByAxis(parse(story));
      for (const axis of axes) {
        if (!refs.has(axis)) {
          offenders.push(
            `${rel(story)} 少了轴 \`${axis}\`（${rel(component)} 的 cva 里有它）`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("手写的候选清单覆盖该轴的每一档（漏档是这条账的日常失效形态）", () => {
    const checked: string[] = [];
    for (const { story, component, axes } of PAIRABLE) {
      const source = parse(story);
      const refs = controlOptionsByAxis(source);
      const derived = new Map(derivedAxisNames(source));
      for (const axis of axes) {
        const arrayName = refs.get(axis);
        if (arrayName === undefined) continue; // 上一段判据的事
        const listed = literalArray(arrayName, source);
        expect(
          listed,
          `${rel(story)} 的 ${arrayName} 不是字面量数组（判据读不到它的成员）`,
        ).not.toBeNull();
        expect(
          [...(listed ?? [])].sort(),
          `${rel(story)} 的 ${arrayName}（轴 \`${axis}\`）与 ${rel(component)} 的 cva ` +
            "对不上：cva 里新加 / 删掉一档时故事要跟着改",
        ).toEqual([...cvaVariantKeys(parse(component), axis)].sort());
        // 「从 props 派生」这条正确写法的证据：轴名有对应的类型别名。
        expect(
          [...derived.values()].includes(axis),
          `${rel(story)} 缺 \`type <别名> = … ComponentProps<typeof <组件>>["${axis}"]\`` +
            " —— 手写清单要挂在从 props 派生的类型上，才有「加一档就报错」的效力",
        ).toBe(true);
        checked.push(`${rel(story)}#${axis}`);
      }
    }
    expect(checked.length).toBeGreaterThan(0);
  });
});
