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
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  controlOptionsByAxis,
  cvaVariantAxes,
  cvaVariantKeysByBinding,
  derivedAxisNames,
  findCvaVariantAccess,
  literalArray,
} from "./storybook-checks/cva-variant-source.mjs";
import {
  NO_STORY_REASON,
  uiCoverage,
} from "./storybook-checks/coverage-ledger.mjs";
import {
  missingRequiredArgs,
  storySurfaces,
} from "./storybook-checks/story-surface.mjs";

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
  /* 理由表空了**不再是违规**，但仍要说清为什么。
   *
   * 这条守卫的原意是「别让人把表删空、然后判据看起来还在跑」—— 而它真正要防的
   * 「判据在空转」这件事，由上面那两条**实测**判据兜着：分子的分母都非空
   * （覆盖率 0/0 或 story 0 份时 `uiCoverage` 的统计本身就是空集）、
   * 且「每个 story 都真的 import 到了组件」那条由用例核。
   * 表空 + 覆盖率 100% 是一个**合法且真实**的状态（这一批就到达了），
   * 把它判红等于要求人为凑一条假理由 —— 那正是这套棘轮最不想鼓励的事。
   *
   * 所以改成「空表必须与 100% 覆盖率同时成立」：表非空而覆盖率满，说明
   * 有人把已经干净的账留在表里；表空而覆盖率不满，说明有人把理由删掉了。 */
  if (NO_STORY_REASON.size === 0 && stat.uncovered.length > 0) {
    out.push(
      "NO_STORY_REASON 是空表，但还有 " +
        stat.uncovered.length +
        " 个组件没有 story（" +
        stat.uncovered.slice(0, 5).join(" / ") +
        "…）—— 要么补 story，要么把理由加回 coverage-ledger.mjs",
    );
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

/**
 * 故事「面」的盘点与单向阻断（口径见 `storybook-checks/story-surface.mjs` 文件头）。
 *
 * 两档刻意分开：
 *  · **title / 连上真组件 / 同目录分组一致** —— 存量已经全绿（实测只有一份缺
 *    title 的历史遗留，本批顺手补上），所以它们**无条件**判；
 *  · **必填 props 有没有 args** —— 存量里有一批正当形态（值在 `render` 里给、
 *    受控开关由 story 持有、注入层的 `sourceName` 就是它的 args），**逐条给它们
 *    白名单会把这张表变成第二份赦免名单**。所以这一档只落在**本次提交动过的**
 *    故事文件上（`--changed`），存量照实盘点、不阻断 —— 口径与「棘轮只挡新增」
 *    一致，理由写在模块文件头。
 * @param {string[]} changedFiles 仓库相对路径
 * @returns {{violations: string[], summary: string}}
 */
function surfaceViolations(changedFiles) {
  const stat = storySurfaces({ componentsRoot: COMPONENTS, repoRoot: ROOT });
  /** @type {string[]} */
  const violations = [];

  for (const file of stat.missingTitle) {
    violations.push(
      file +
        " 没有 `title` —— Storybook 会按路径自动生成一个条目，它落在侧栏的哪个\n" +
        "    分组里取决于推导规则，于是「按 UI/Studio/Workshop 分组浏览」这件事只在\n" +
        "    每份故事都写了 title 时成立。构建、覆盖率、画布渲染都不会因此报错。",
    );
  }
  for (const file of stat.missingComponent) {
    violations.push(
      file +
        " 没有把**真组件**接上 —— 本目录的组件既没被 import，也没在文件里用到。\n" +
        "    → 常规写法是 `component: <真组件>`；要用适配件（受控状态 / 值源解析 /\n" +
        "      把复合件摆成一行）也可以，但适配件里必须真的渲染那个组件 ——\n" +
        "      口径见 `scripts/storybook-checks/story-surface.mjs` 文件头。",
    );
  }
  for (const d of stat.groupDeviations) {
    violations.push(
      "同目录的多数故事把分组写在 `" +
        d.expected +
        "/` 下，而 " +
        d.file +
        " 写的是 `" +
        d.group +
        "` —— 分组靠人写 `title:` 的字符串维系，没有判据时同一目录会长出两套前缀。",
    );
  }

  /* 必填 props 这一档：只判本次动过的故事文件（口径见上面的函数注释）。 */
  const changed = new Set(changedFiles);
  let argsChecked = 0;
  for (const story of stat.stories) {
    if (!changed.has(story.file)) continue;
    const missing = missingRequiredArgs(
      path.join(ROOT, story.file),
      new Set(story.args),
    );
    if (missing.length === 0) {
      argsChecked += 1;
      continue;
    }
    violations.push(
      story.file +
        " 没给必填 props 的 `args`：" +
        missing.join(" / ") +
        "\n" +
        "    → 组件在画布上读到 `undefined`（表现与「侧栏有故事、画布一片空白」同形）。\n" +
        "      给了就是给了：写进 `args`，或在适配件 / `render` 里显式传（注入层\n" +
        "      解析出来的值也算）—— 判据按「story 文件里有没有这个名字的赋值点」认，\n" +
        "      所以适配件里已经传了的**不会**被报缺。",
    );
  }

  return {
    violations,
    summary:
      "故事面 " +
      stat.stories.length +
      " 份（缺 title " +
      stat.missingTitle.length +
      " / 未接真组件 " +
      stat.missingComponent.length +
      " / 分组偏离 " +
      stat.groupDeviations.length +
      "；本次动过 " +
      changed.size +
      " 份里判过 args 的 " +
      argsChecked +
      " 份）",
  };
}

/**
 * 本次提交动过的故事文件（仓库相对路径）。
 *
 * 默认给空数组（= 只盘点、不阻断 args 那一档）；`.githooks/pre-commit` 用
 * `--changed` 把暂存区那一份交给它 —— 判据的**执行者**是钩子，钩子里才知道
 * 「这次改了哪些文件」（口径与其余棘轮的「只挡新增」一致）。
 * 读法是 `git diff --cached --name-only`：暂存区是提交的**输入**，不是 HEAD 与
 * 工作区的差 —— 后者在「改了还没 add」时会凭空多出一份不该判的文件。
 * @returns {string[]}
 */
function changedStoryFiles() {
  if (!process.argv.includes("--changed")) return [];
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.error !== undefined || result.status !== 0) {
    /* 拿不到清单时退回空：这一档是**增量**层，读不到就退成盘点 ——
       但要说出来，不能静默（静默的判据比没有判据更糟）。 */
    process.stderr.write(
      "[storybook] 读不到暂存区清单，本次只盘点、不判必填 props 那一档\n",
    );
    return [];
  }
  return String(result.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".stories.tsx"));
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
      /* 一个组件文件里可以有**多处** `cva()`，而它们的轴名可能同名
         （`ui/item.tsx` 的 `itemVariants.variant` 与 `itemMediaVariants.variant`）。
         这时正确的比较是「story 那份清单与**其中一处**逐字对得上」，不是与并集比
         —— 并集会把一份正确的 `["default","outline","muted"]` 判成「缺 icon / image」，
         而修法无处可去（补上那两档，itemVariants 那一处又该报「多」）。 */
      const candidates = [...cvaVariantKeysByBinding(parse(component), axis)];
      const matched = candidates.some(([, keys]) => {
        const miss = keys.filter((k) => !listed.includes(k));
        const ex = listed.filter((k) => !keys.includes(k));
        return miss.length === 0 && ex.length === 0;
      });
      if (!matched) {
        /* 报错时给最接近的那一处（差得最少），否则「与哪一处对不上」读不出来。 */
        const described = candidates
          .map(([binding, keys]) => {
            const miss = keys.filter((k) => !listed.includes(k));
            const ex = listed.filter((k) => !keys.includes(k));
            return {
              binding,
              miss,
              ex,
              diff: miss.length + ex.length,
            };
          })
          .sort((a, b) => a.diff - b.diff)[0];
        violations.push(
          `${rel(story)} 的 ${arrayName}（轴 \`${axis}\`）与 ${rel(component)} 的 cva 对不上` +
            (described === undefined
              ? "（该文件里这一轴一处都没有）"
              : `（最接近的是 ${described.binding}` +
                (described.miss.length > 0
                  ? `：缺 ${described.miss.join(" / ")}`
                  : "") +
                (described.ex.length > 0
                  ? `：多 ${described.ex.join(" / ")}`
                  : "") +
                "）"),
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
  const surface = surfaceViolations(changedStoryFiles());
  violations.push(...surface.violations);
  process.stdout.write("[storybook] " + surface.summary + "\n");

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
