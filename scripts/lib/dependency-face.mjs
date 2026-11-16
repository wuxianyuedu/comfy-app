/**
 * 依赖面是哪几个文件 —— 唯一出处。
 *
 * 为什么单独成件（而不是留在 `check-deps-freshness.mjs` 里由别人 import）：
 * 那份判据的模块图带着 `lockfile/lock-diff.mjs`、`launcher-core/worktree.mjs` 等
 * 一串下游，而这里要的只是一个三项的字符串数组。为一个常量拖着别人的整条链，代价
 * 表现在两处：门禁自测得把那些下游一并拷进临时工作区才跑得起来（缺一个的表现是
 * `ERR_MODULE_NOT_FOUND`、读起来像被测判据坏了）；而更坏的一侧是「嫌麻烦就不 import 了、
 * 就地抄一份」—— 抄的那份不会跟着长，将来清单加第四项时本判据静默漏判（§12.12
 * 说的「漂开的形态是静默的」）。同一族做法的先例是 `endpoints.ts`（默认地址只定义一次）
 * 与 `gate-scan-read.cjs`（扫描与 `--staged` 短路只实现一次）。
 *
 * ⚠️ **与 `check-docs-api.cjs` 的 `INPUT_RES` 刻意不共用**（那条口径见
 * `check-deps-freshness.mjs` 里 `matchedDependencyFiles()` 的文件头）：那一份问的是
 * 「typedoc 产物的输入面变没变」，本份问的是「**依赖声明与安装规则**变没变」。
 * 两份恰好都含 `package.json`，但集合与语义不同 —— 合并会让任一侧的收窄静默改变
 * 另一侧的行为。
 */

/**
 * 「动了它就得回答『基线是不是旧的』」与「动了它才可能带进新的构建脚本」共用的那一份清单。
 *
 * 三个各自不可替代：`package.json` 是版本声明、`pnpm-lock.yaml` 是解析结果、
 * `pnpm-workspace.yaml` 是安装规则（`allowBuilds` / `overrides` 变了，同一份 lockfile
 * 装出来的东西都可能不同）。别按「有没有改 lockfile」一刀切 —— 远端只改
 * `allowBuilds` 那一档正是最容易被漏掉的。
 */
export const DEPENDENCY_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
