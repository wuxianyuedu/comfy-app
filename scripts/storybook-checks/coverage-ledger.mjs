#!/usr/bin/env node
// @ts-nocheck -- 纯函数台账（与 scripts/storybook-check.mjs 同款：本仓的门禁脚本
// 不走 tsc 的类型检查，判据由各自的契约测试守着）
// 「哪些组件有故事」的台账（供 tests/storybook-component-coverage.test.ts 与
// 门禁 scripts/storybook-check.mjs 共用）。
//
// 为什么要它：`docs/guide-storybook.md` 的「它不做什么」写着「当前只有 3 个
// `ui/` 示例」—— 那是一个**会过期的事实**，而它过期时没有任何东西会红。
// F6 的「组件覆盖率」这一格此前就是这么挂着的：数字写在文档里，没人负责让它
// 变准。本模块把「事实」变成可枚举的：扫描 `*.stories.tsx`，算出**被一个 story
// 直接 import 的 `ui/` 组件**，再和下面这份理由表比。
//
// 理由表（`NO_STORY_REASON`）**不是赦免名单**：加一行就等于说清「为什么它现在
// 不该有 story」，且这个理由要能被读者复核。判据只认这一份，文档里的数字由它
// 派生，不再手写。
//
// 分母 = `ui/` 下「有可预览界面形态」的文件：**排除**测试 / 快照与被测 hook
// （`.test.ts(x)`、`.test.ts` 的兄弟 `.ts`）与 `use-*.ts` —— story 是「起工作台
// 看一眼」，hook 没有可看的东西，它的判据是单测。

import fs from "node:fs";
import path from "node:path";

/**
 * 分母之外的形态：**没有可预览的界面**，story 里只会多一行 `import`。
 *
 * 每一项都要能回答「那我怎么验它」，答案写在同一行里。
 */
export const NOT_A_UI_SURFACE = new Map([
  [
    ".test.ts(x) 与被测的 .ts 兄弟",
    "单测的执行者（`use-*.ts` 的判据在用例里，见规范 11 §11.7 的覆盖率门槛）",
  ],
  ["use-*.ts", "React hook：没有 DOM 形态，判据只能是用例（同上）"],
  [
    "纯口径模块（常量表 / 派生函数）",
    "没有可看的东西；加 story 等于把 import 抄一遍，见下面 NO_STORY_REASON",
  ],
]);

/**
 * 落在分母内（有界面形态）但**当前没有** story 的文件 → 为什么可以先没有。
 *
 * **加一行之前先回答「没有 story 的代价是什么」**：若代价是「改了样子没人看得见」，
 * 它就该有 story（哪怕要用 Args 注入数据），不该进这张表。逐条写清代价与替代。
 */
export const NO_STORY_REASON = new Map([
  // ── 被其它基元 import 的部件：它的形态在调用它的基元 story 里已经看得到 ──
  [
    "dialog-overlay.ts",
    "`ui/dialog` 的遮罩类名常量；形态在 dialog 的弹层里，单独一个 story 看不到",
  ],
  ["dialog-width.ts", "纯常量 + 派生函数（弹窗宽度的单一出处），无 DOM"],
  [
    "progress.tsx",
    "shadcn 的 Track/Indicator 薄封装；可见形态由 `ui/progress-bar` 承载（它自己的 story 里就画着 Track）",
  ],
  [
    "sonner.tsx",
    "`Toaster` 容器：只有真出 toast 才画得出东西，属「起整个应用看」那一档",
  ],
  [
    "error-boundary.tsx",
    "只有子树**抛错**时才渲染，Args 注不进去（要靠一个会抛的兄弟组件）",
  ],
]);

/**
 * 收集 `src/components/**` 下的故事文件。
 * @param {string} componentsRoot
 * @returns {string[]}
 */
export function collectStories(componentsRoot) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.name.endsWith(".stories.tsx")) {
        out.push(full);
      }
    }
  };
  walk(componentsRoot);
  return out.sort();
}

/**
 * 故事文件 import 的 `ui/` 组件（`./badge` 或 `~/components/ui/badge`）。
 *
 * 为什么不直接按文件名配对：真正的契约是「这份 story 讲的是哪个组件」，而那件
 * 事只由 `import` 表达 —— `badge.stories.tsx` 讲 `./badge` 是命名约定，而
 * `simple-key-handler.stories.tsx` 讲的是 `simple-key-handler.ts`（无 JSX）。
 * 咬住 import 让两种形态共用一条判据，也顺带挡住「story 建了、却没 import 任何
 * 组件」这种空转 —— 那样它既不是「这个组件的 story」，也不该给它记一分。
 *
 * 两种说明符都认：同目录相对路径（`./x`）与仓库别名（`~/components/ui/x`）。
 * 别名写法是 `~` 前缀的约定（规范 §12.2），实际 story 用它更多；只认相对路径
 * 会让判据整体返回 0，而那正好是「判据在场、什么都没判」的静默失效。
 *
 * @param {string} storyFile
 * @param {string} source 已读入的源码
 * @param {string} repoRoot
 * @returns {string[]} 命中真实文件的绝对路径
 */
export function componentTargetsOf(storyFile, source, repoRoot) {
  /** @type {string[]} */
  const out = [];
  const dir = path.dirname(storyFile);
  const re = /from\s+"([./~][^"]*)"/g;
  for (const match of source.matchAll(re)) {
    const spec = match[1];
    const bases = spec.startsWith("~/")
      ? [path.join(repoRoot, "src", spec.slice(2))]
      : spec.startsWith("./") || spec.startsWith("../")
        ? [path.join(dir, spec)]
        : [];
    for (const base of bases) {
      for (const ext of ["", ".tsx", ".ts"]) {
        const cand = base + ext;
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          out.push(cand);
          break;
        }
      }
    }
  }
  return out;
}

/** 分母内的文件：`ui/` 下、不是故事、不是 `.test.*` 系列、不是 `use-*.ts`。 */
function isUiSurface(name) {
  if (name.endsWith(".stories.tsx")) return false;
  if (name.includes(".test.")) return false;
  if (name.startsWith("use-") && name.endsWith(".ts")) return false;
  return true;
}

/**
 * 算一遍 `ui/` 的组件覆盖率。
 * @param {{componentsRoot: string, uiDir?: string}} input
 * @returns {{total: number, covered: string[], uncovered: string[], stories: number, unknownSkip: string[], staleSkip: string[]}}
 */
export function uiCoverage({ componentsRoot, uiDir }) {
  const ui = uiDir ?? path.join(componentsRoot, "ui");
  const stories = collectStories(componentsRoot);

  /** @type {Set<string>} */
  const covered = new Set();
  for (const story of stories) {
    for (const target of componentTargetsOf(
      story,
      fs.readFileSync(story, "utf8"),
      path.resolve(componentsRoot, "..", ".."),
    )) {
      if (path.dirname(target) === ui) covered.add(path.basename(target));
    }
  }

  const files = fs
    .readdirSync(ui, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter(isUiSurface)
    .sort();

  return {
    total: files.length,
    covered: files.filter((f) => covered.has(f)),
    uncovered: files.filter((f) => !covered.has(f)),
    stories: stories.length,
    // 理由表里指向**不存在的文件**的项 = 过期条目（文件改名 / 搬走了）。
    unknownSkip: [...NO_STORY_REASON.keys()].filter(
      (f) => !files.includes(f) && !fs.existsSync(path.join(ui, f)),
    ),
    // 理由表里的文件其实已经有 story = 该删条目（否则它会静默放行未来的回归）。
    staleSkip: [...NO_STORY_REASON.keys()].filter(
      (f) => files.includes(f) && covered.has(f),
    ),
  };
}
