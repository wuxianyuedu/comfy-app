#!/usr/bin/env node
/**
 * quality-gate-shared.mjs — 质量门禁的**共享常量与拼装逻辑**（规范 11.12）
 *
 * 已知基线失败登记表只有一处来源：先前它写在 `scripts/quality-gate.ps1` 里，
 * `scripts/run-tests.ps1` 用正则去解析那份 PowerShell 源码。两份实现（PowerShell
 * 与 Node）都要读同一份清单时，从 `.ps1` 源码里解析就等于把「另一门语言的文件」
 * 当成数据源 —— 改一次缩进/写法就会让解析静默返回空数组（排除项悄悄失效，
 * 红/绿不再可归因）。因此清单搬到本模块（纯数据 + 纯函数、零依赖），两侧都 import。
 *
 * ── 粒度（ISSUE #1282 的收尾）────────────────────────────────────────────
 *
 * 这张表的粒度**是用例**，不是文件。它曾经是文件（`--exclude <文件>`），而代价
 * 在 2026-10-05 那次登记上量清了：`tests/theme-dark-token-cascade.test.ts` 一条
 * 断言红，整份文件被排除，**同文件另外 17 条已绿的断言一起被摘掉**，而它们在别处
 * 没有更强的执行者。这正是规范 §11.12 反复点名的那一族：**比红更糟的是静默跳过**。
 *
 * 于是登记项从「文件路径」变成「文件 + 用例全名」，排除手段从
 * `vitest run --exclude <文件>` 变成 `vitest run -t '<负前瞻正则>'`：
 *
 *   - vitest 没有「按用例排除」的原生 flag —— `--exclude` 只吃文件 glob，
 *     `-t/--testNamePattern` 是**正向**过滤器（正则匹配上才跑）。
 *   - 但 `-t` 吃的是**正则**、且判据用的是 `fullTestName.match(pattern)`
 *     （vitest 5 `task-utils.js` 的 `interpretTaskModes`），所以「除这条以外的全跑」
 *     可以写成 `^(?!(<转义后的全名>)$).*$` —— 负前瞻 + 全名锚定。
 *   - **全名是什么**：祖先标题与用例标题用 `" > "` 连接（`getFullName` 的默认分隔符，
 *     不是空格、也不是 JSON 报告里的那个空格形态）。实测：`-t '^(?!outer > drop me$).*$'`
 *     跑 1 条跳 1 条；拿空格拼就一条都不排除（静默失效，所以这条口径必须钉在用例里）。
 *
 * ⚠️ **`-t` 是一个全局过滤器**，所以这条设计带一个必须机器判的前置条件：**登记项
 * 的全名必须在整个测试面里唯一**。否则同一个全名若在另一份文件里也存在，那次运行
 * 会把那份文件里的**无关用例**一起静默跳过 —— 等于把一个静默失效换成另一个更难
 * 发现的静默失效。唯一性由 `scripts/check-known-failed-stale.mjs` 判（见该文件）。
 *
 * ── 登记纪律（未变，规范 §11.12）────────────────────────────────────────
 *
 * 只放「确证与本次改动无关的历史基线失败」，**每一条都要写明归属与谁来修**；
 * 修好就立刻删。再要登记前先做两件事：① 按规范 §13.6.2 复算 master 基线
 * （`git worktree add ../.wt-base-check cnb/master` 后在干净基线上跑同一条判据），
 * 确证是别线的红、不是本次改动引入；② 想清楚那条门禁在别处有没有更强的执行者。
 * ⚠️ 这条纪律**不再只靠人记得**：`scripts/check-known-failed-stale.mjs`（pre-commit
 * D 组）判三头 —— 登记项的文件必须真实存在且被 git 跟踪、全名必须唯一、且这条
 * 用例必须真的还红着（全绿即判「登记已过期」并要求删除）。规范 §11.12 第 3、4 条。
 */

/**
 * 一条登记项。
 *
 * @typedef {object} KnownFailedCase
 * @property {string} file      仓库相对路径（`git ls-files` 口径，正斜杠）
 * @property {string} fullName  用例全名：祖先标题与用例标题按 `" > "` 连接
 * @property {string} why       归属与「谁来修」—— 散文，机器不判，但缺了人就查不到
 */

/**
 * @type {KnownFailedCase[]}
 *
 * 空数组（终态）。上一次登记是 `tests/theme-dark-token-cascade.test.ts`
 * （2026-10-05 登记 → ISSUE #1282 处置后删除），它留下的教训值得单独写在这，
 * 因为**登记时写的那条理由本身就是错的**：
 *
 * 登记词写的是「`.bg-card` 那条规则没出现在固定输入源的产物里」，据此判定「不是
 * 『断言依赖的类没被固定住』那一类，而是 globals.css 侧 utility 生成路径变了」。
 * 复算后发现两头都反了：产物里 `.bg-card { background-color: var(--color-card) }`
 * 一直在（`PINNED_UTILITY_CLASSES` 也一直点着它），真因是**判据自己的白名单漏了
 * 第三种拼法** —— 正则写的是 `var\(--(card|color-surface)\)`，而 `--color-card`
 * 成为项目 token 唯一事实来源之后，utility 编出的就是 `var(--color-card)`。
 * 于是这条断言**在它被写下的那天起就不是「性质」而是「拼法的枚举」**，枚举漏了
 * 第三种；而白名单漏项与业务回归长得一模一样（都是 `toMatch` 红），所以没有人
 * 能从那句报错里读出「这是判据自己的问题」。
 *
 * 这与更早「第一个被删的 `theme-token-single-source.test.ts`」是同一味药：
 * **登记理由必须是复算过的事实，不能是「看起来像的原因」** —— 理由写错的例外项
 * 比没有例外项更糟，它会让下一个人照着一个假根因去修。
 *
 * 处置（ISSUE #1282）：判据改成断言**性质**（取值来自 `var()` + 那颗变量两态
 * 解得出非空值），不再枚举拼法；粒度从文件收到用例；「登记过期」本身升成判据。
 *
 * 登记项的写法（照抄形状，别自己发明）：
 *
 *   { file: "tests/foo.test.ts",
 *     fullName: "某个 describe 的标题 > 那条红的用例标题",
 *     why: "归属线 + ISSUE 号；修好后立刻删" }
 */
export const KNOWN_FAILED_CASES = [];

/**
 * 登记项覆盖到的文件（去重、保序）。
 *
 * 派生量，**不是**第二份清单：给「按文件看」的读者（`.ps1` 的打印、`visual-gate`
 * 的透传、文档）一个稳定的视图。消费方一律用下面的 `vitestExcludeArgs`，
 * 别拿它去拼 `--exclude` —— 那会把粒度退回文件，正是 ISSUE #1282 修掉的那件事。
 * @type {string[]}
 */
export const KNOWN_FAILED_FILES = [
  ...new Set(KNOWN_FAILED_CASES.map((c) => c.file)),
];

/**
 * 正则元字符转义（`String.prototype.replace` 的回调拿到的是整段匹配，所以不用 `$&` 逃逸）。
 * @param {string} text
 * @returns {string}
 */
export function escapeRegExp(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把这些登记项拼成 `vitest -t` 的**排除模式**：除这些全名以外全跑。
 *
 * 形状 `^(?!(A|B)$).*$`：`^` 与末尾 `$` 让前瞻只对齐整条全名（子串不算），
 * 前瞻里失败即整体不匹配 ⇒ 该用例被 skip；其余用例走 `.*$` 正常匹配上。
 *
 * @param {KnownFailedCase[]} cases
 * @returns {string | undefined} 空清单返回 `undefined`（调用方据此不加参数）
 */
export function vitestNameExcludePattern(cases) {
  if (cases.length === 0) return undefined;
  const names = cases.map((c) => escapeRegExp(c.fullName)).join("|");
  return `^(?!(${names})$).*$`;
}

/**
 * 拼给 vitest 的排除参数（`["-t", <pattern>]`）；空清单返回 `[]`。
 *
 * 消费方一律用本出口，不要各自 `args.push("-t", …)` ——「模式长什么样」与
 * 「转义做没做」只能有一处实现（同 §12.14 的端点收口口径）。
 * @param {KnownFailedCase[]} cases
 * @returns {string[]}
 */
export function vitestExcludeArgs(cases) {
  const pattern = vitestNameExcludePattern(cases);
  return pattern === undefined ? [] : ["-t", pattern];
}

/**
 * 打印给人看的一行一句（消息/日志用）。
 * @param {KnownFailedCase[]} cases
 * @returns {string[]}
 */
export function describeKnownFailedCases(cases) {
  return cases.map((c) => `${c.file} :: ${c.fullName}`);
}
