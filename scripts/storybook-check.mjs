#!/usr/bin/env node
// @ts-nocheck -- 故事文件的枚举来源门禁（供 .githooks/pre-commit 的 D 组调用）
//
// 判据内容与 `tests/storybook-cva-variant-source.test.ts` **同源**：脚本自己不做
// 第二份实现，直接把组件源码喂给 `scripts/storybook-checks/cva-variant-source.mjs`
// 里那几个纯函数。为什么要有脚本这一层：pre-commit 的 C 组是「固定清单 + 受影响
// 用例」的**增量**层，而这条判据守的是「下一次有人写故事」——钩子以外的人
// （以及只看脚本的读者）也要能一条命令问出结论，口径见规范 16 §16.2.3.2。
//
// 这一刀又加了一段：**组件覆盖率的棘轮**。前三段守的是「已经写下的 story 怎么
// 写」，对「`ui/` 里 157 个文件只有 3 个有 story」天然无感 —— 而 F6 的
// 「组件覆盖率」那一格正是这么挂着的：数字写在文档里，没人负责让它变准。
// 现在数字由 `scripts/storybook-checks/coverage-ledger.mjs` 现算，与
// `scripts/.storybook-coverage-baseline.json` 比：**只许升不许降**，且理由表
// 里指向不存在文件的条目、以及「已经有 story 却还留在理由表里」的条目都算违规。
// （「为什么不给它写 story」的逐条理由就在那份台账里，不在这里再抄。）
//
// 退出码：0 通过 / 1 有违规。零网络、零子进程，纯本地读文件。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  controlOptionsByAxis,
  cvaVariantAxes,
  cvaVariantKeys,
  derivedAxisNames,
  findCvaVariantAccess,
  literalArray,
} from "./storybook-checks/cva-variant-source.mjs";
import {
  NO_STORY_REASON,
  uiCoverage,
} from "./storybook-checks/coverage-ledger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = path.join(ROOT, "src", "components");
const COVERAGE_BASELINE = path.join(
  ROOT,
  "scripts",
  ".storybook-coverage-baseline.json",
);

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectStories(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      collectStories(full, out);
    } else if (entry.name.endsWith(".stories.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} file
 * @returns {import("typescript").SourceFile}
 */
function parse(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** 故事同目录的组件源码（`badge.stories.tsx` → `badge.tsx`，再试 `.ts`）。 */
function componentSourceOf(story) {
  const base = story.replace(/\.stories\.tsx$/, "");
  for (const ext of [".tsx", ".ts"]) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      /* 换下一个扩展名 */
    }
  }
  return null;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

/**
 * 组件覆盖率棘轮。口径与其余棘轮一致（规范 §12.13 / §16.2.3）：
 * **只许升不许降**，理由表的条目也要与磁盘对得上。
 * @returns {string[]} 违规描述
 */
function coverageViolations() {
  if (!existsSync(COVERAGE_BASELINE)) {
    return [
      "缺少基线 " + rel(COVERAGE_BASELINE) + " —— 棘轮没有起点，先补它再提交",
    ];
  }
  const baseline = JSON.parse(readFileSync(COVERAGE_BASELINE, "utf8"));
  const stat = uiCoverage({ componentsRoot: COMPONENTS });
  /** @type {string[]} */
  const out = [];

  if (stat.covered.length < baseline.covered) {
    out.push(
      "组件覆盖率下降：" +
        stat.covered.length +
        " 有 story，" +
        "基线是 " +
        baseline.covered +
        "（只许升不许降）\n" +
        "    → 先看 `git status` 里有没有被删 / 改名的 \`.stories.tsx\`，" +
        "或组件文件改名后 story 的 import 没跟着改。\n" +
        "    → 确属有意收窄（真的删掉了某个组件的 story）时，同批把 " +
        rel(COVERAGE_BASELINE) +
        " 的 covered 改小并在提交说明里写清理由。",
    );
  }
  if (stat.total !== baseline.uiSurfaces) {
    out.push(
      "`ui/` 的可预览文件数从基线的 " +
        baseline.uiSurfaces +
        " 变成 " +
        stat.total +
        " —— 新增 / 删除了组件，同批把 " +
        rel(COVERAGE_BASELINE) +
        " 的 uiSurfaces 改成新值\n" +
        "    → 新增的那个要回答「它为什么没有 story」：有界面形态就补一份，\n" +
        "      没有就写进 coverage-ledger.mjs 的 NO_STORY_REASON（逐条给理由）。",
    );
  }

  // 理由表必须与磁盘对得上：指向不存在的文件 = 过期条目；
  // 已经有 story 却还留着 = 它会静默放行「下一个人把它改回去」。
  for (const name of stat.unknownSkip) {
    out.push(
      "NO_STORY_REASON 里的 " + name + " 在 ui/ 下不存在（改名 / 搬走了？）",
    );
  }
  for (const name of stat.staleSkip) {
    out.push(
      "NO_STORY_REASON 里的 " + name + " 已经有 story 了 —— 删掉这条理由",
    );
  }
  if (NO_STORY_REASON.size === 0) {
    out.push("NO_STORY_REASON 是空表 —— 判据在空转，先检查它是不是被删空了");
  }

  process.stdout.write(
    "[storybook] 组件覆盖率 " +
      stat.covered.length +
      "/" +
      stat.total +
      "（基线 " +
      baseline.covered +
      "/" +
      baseline.uiSurfaces +
      "，理由表 " +
      NO_STORY_REASON.size +
      " 条）\n",
  );
  return out;
}

function main() {
  const stories = collectStories(COMPONENTS).sort();
  if (stories.length === 0) {
    process.stderr.write(
      "[storybook] 一个故事文件都没扫到 —— 判据在空转，先检查 src/components 是否还在\n",
    );
    return 1;
  }

  /** @type {string[]} */
  const violations = [];
  let checkedPairs = 0;

  for (const story of stories) {
    const storySource = parse(story);
    // ① 别从 cva 的返回值上取枚举
    for (const hit of findCvaVariantAccess(storySource, rel(story))) {
      violations.push(
        `${rel(story)}:${hit.line} 从 cva 的返回值上取枚举：${hit.text}\n` +
          "    → cva() 返回的是函数，运行时没有 .variants（Storybook 加载期抛 " +
          "Cannot read properties of undefined）\n" +
          '    → 改成从 props 派生：NonNullable<React.ComponentProps<typeof C>["轴"]>',
      );
    }

    // ② argTypes.options 指向的清单真的存在
    const declared = new Set(
      storySource.statements.flatMap((stmt) =>
        ts.isVariableStatement(stmt)
          ? stmt.declarationList.declarations
              .filter((d) => ts.isIdentifier(d.name))
              .map((d) => d.name.text)
          : [],
      ),
    );
    for (const [axis, arrayName] of controlOptionsByAxis(storySource)) {
      if (!declared.has(arrayName)) {
        violations.push(
          `${rel(story)} → argTypes.${axis}.options 指向 ${arrayName}，但文件里没有这个声明`,
        );
      }
    }

    // ③④ 逐轴比对档位
    const component = componentSourceOf(story);
    if (component === null) continue;
    const axes = [...cvaVariantAxes(parse(component)).keys()];
    if (axes.length === 0) continue;
    checkedPairs += 1;

    const refs = controlOptionsByAxis(storySource);
    const derived = new Map(derivedAxisNames(storySource));
    for (const axis of axes) {
      const arrayName = refs.get(axis);
      if (arrayName === undefined) {
        violations.push(
          `${rel(story)} 少了轴 \`${axis}\`（${rel(component)} 的 cva 里有它）—— 那一档没人验`,
        );
        continue;
      }
      const listed = literalArray(arrayName, storySource);
      if (listed === null) {
        violations.push(
          `${rel(story)} 的 ${arrayName} 不是字面量数组，判据读不到它的成员`,
        );
        continue;
      }
      const expected = cvaVariantKeys(parse(component), axis);
      const missing = expected.filter((k) => !listed.includes(k));
      const extra = listed.filter((k) => !expected.includes(k));
      if (missing.length > 0 || extra.length > 0) {
        violations.push(
          `${rel(story)} 的 ${arrayName}（轴 \`${axis}\`）与 ${rel(component)} 的 cva 对不上` +
            (missing.length > 0 ? `：缺 ${missing.join(" / ")}` : "") +
            (extra.length > 0 ? `：多 ${extra.join(" / ")}` : ""),
        );
      }
      if (![...derived.values()].includes(axis)) {
        violations.push(
          `${rel(story)} 的轴 \`${axis}\` 没有挂到从 props 派生的类型上\n` +
            `    → 补 \`type <别名> = NonNullable<React.ComponentProps<typeof <组件>>["${axis}"]>\``,
        );
      }
    }
  }

  if (checkedPairs === 0) {
    process.stderr.write(
      "[storybook] 没有一组「有 cva 变体轴的组件 + 它的 story」被比对到 —— 判据在空转\n",
    );
    return 1;
  }

  violations.push(...coverageViolations());

  if (violations.length > 0) {
    process.stderr.write(
      `[storybook] ${violations.length} 处违规（枚举来源见规范 16 §16.2.3.2，` +
        "组件覆盖率见 docs/guide-storybook.md）\n\n",
    );
    for (const v of violations) process.stderr.write(`  ✗ ${v}\n`);
    process.stderr.write(
      "\n写法样板见 src/components/ui/button.stories.tsx 与 docs/guide-storybook.md。\n",
    );
    return 1;
  }

  process.stdout.write(
    `[storybook] 故事枚举来源 OK（${stories.length} 份 story，${checkedPairs} 组逐轴比对）\n`,
  );
  return 0;
}

process.exit(main());
