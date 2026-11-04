/**
 * 故事文件的**枚举来源**判据（ISSUE #1381 续）：`cva()` 返回函数，`.variants` 只在 TS 泛型里、运行时没有——
 * `Object.keys(x.variants.variant)` 会 tsc 红（仅跑过 tsc 处）或 Storybook 加载期抛 `Cannot read properties of undefined`（画布空白）。四条判据：
 * ① 别从 cva 返回值取枚举（按 `cva` 绑定名判，改名不能绕过）；② 手写候选清单不许漏档（轴链接走 `argTypes.options`）；③ `argTypes.options` 指向文件真有的清单（拼错＝下拉空且不报错）；④ 每个变体轴故事都列出。已知边界：只覆盖 `cva` 里 `variants` 字面量 key，外部常量/计算属性报「轴数为 0」即跳过。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  controlOptionsByAxis,
  cvaVariantAxes,
  cvaVariantKeysByBinding,
  derivedAxisNames,
  findCvaVariantAccess,
  literalArray,
} from "../scripts/storybook-checks/cva-variant-source.mjs";

const ROOT = resolve(".");
const COMPONENTS = join(ROOT, "src", "components");

/** 递归收集 `*.stories.tsx`（不只看 `ui/`：故事的后继落点可能在业务目录）。 */
function collectStories(dir: string, out: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
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
  if (component === null) {
    return [];
  }
  const axes = [...cvaVariantAxes(parse(component)).keys()];
  return axes.length === 0 ? [] : [{ story, component, axes }];
});

const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");

describe("故事文件的枚举来源（ISSUE #1381）", () => {
  it("stories glob 能扫到的故事文件不为空（空集 = 判据在空转）", () => {
    expect(STORIES.length).toBeGreaterThan(0);
  });

  it("没有任何一份 story 从 cva 的返回值上取变体表", () => {
    const offenders: Array<string> = [];
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
    const offenders: Array<string> = [];
    for (const story of STORIES) {
      const source = parse(story);
      const declared = new Set(
        source.statements.flatMap((stmt) =>
          ts.isVariableStatement(stmt)
            ? stmt.declarationList.declarations
                .filter((d) => ts.isIdentifier(d.name))
                /* SAFETY: 类型断言已复核 */
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
    const offenders: Array<string> = [];
    for (const { story, component, axes } of PAIRABLE) {
      const refs = controlOptionsByAxis(parse(story));
      for (const axis of axes) {
        if (!refs.has(axis)) {
          offenders.push(`${rel(story)} 少了轴 \`${axis}\`（${rel(component)} 的 cva 里有它）`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("手写的候选清单覆盖该轴的每一档（漏档是这条账的日常失效形态）", () => {
    const checked: Array<string> = [];
    for (const { story, component, axes } of PAIRABLE) {
      const source = parse(story);
      const refs = controlOptionsByAxis(source);
      const derived = new Map(derivedAxisNames(source));
      for (const axis of axes) {
        const arrayName = refs.get(axis);
        if (arrayName === undefined) {
          continue;
        } // 上一段判据的事
        const listed = literalArray(arrayName, source);
        expect(
          listed,
          `${rel(story)} 的 ${arrayName} 不是字面量数组（判据读不到它的成员）`,
        ).not.toBeNull();
        /* 一个组件文件里可以有多处 `cva()`，轴名可能同名（`ui/item.tsx` 的
           `itemVariants.variant` 与 `itemMediaVariants.variant`）。这时正确的
           判据是「与**其中一处**逐字对得上」，不是与并集比：并集会把一份正确的
           清单判成「缺档」，而修法无处可去（补了那一处，另一处又该报「多」）。 */
        const candidates = [...cvaVariantKeysByBinding(parse(component), axis)];
        expect(
          candidates.length,
          `${rel(component)} 里轴 \`${axis}\` 一处都没取到 —— 判据在空转`,
        ).toBeGreaterThan(0);
        const sorted = [...(listed ?? [])].sort();
        expect(
          candidates.map(([, keys]) => [...keys].sort()),
          `${rel(story)} 的 ${arrayName}（轴 \`${axis}\`）与 ${rel(component)} 的 ` +
            "cva 对不上：cva 里新加 / 删掉一档时故事要跟着改（多处同名轴时与其中" +
            "任意一处对得上即可）",
        ).toContainEqual(sorted);
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
