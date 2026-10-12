## Fixed

- **master 上的三档 `baseline-red` 全部清掉（ISSUE #1811 的收尾）**。上一刀 #1823
  落地后 master 自己就是红的：18 条 e2e、6 条覆盖率门槛、bundle 预算 +402 B。
  逐项在干净 master 上复现过（§13.6.2），根因三条各不相同，本次逐条修：

  ### ① 18 条 e2e：两次已合并的改动各自留下没同批更新的判据

  - **`f72a55ee`（PR #1786 / ISSUE #1784）改了行为、判据没同批改** —— 那一刀把设置 /
    模型适配 / 模式契约改成**瞬时页签：切走即关**，而 `overlay-entries-as-views.spec.ts`
    仍然断言「开两屏页签数涨到 3、两页并存」。改到新世界之后这一份**判的东西更强**：
    瞬时页签的真契约是「切走即关、回来又有、且始终只有一条」——
    旧写法数「页签总数」会随瞬时语义来回变，而「只有一条」不会。
  - **同一次 `dynamic()` 化让画布 CSS 不再随 `/workspace` 急加载**：
    `WorkspaceViewStack` 把**所有**视图改成 `next/dynamic`（含 `ProjectCanvas`），
    而 `theme-token-consumers` 有一条判据是「navigation 到 `/workspace` 后就取
    `document.styleSheets` 里的 xyflow 规则」（它自己报的正是「这条用例的前提没了」）。
    核过产物：规则确实在 `.next/static/chunks/*.css` 里，是**进 DOM 的时机**变了。
    改成「先开画布那一屏」——这既是前提，也让它成为**真的**用户路径（用户看到网格线
    正是因为他打开了画布）。顺带发现画布是 `projectScoped`：没有活跃项目时
    `openViewTab` 的 `makeTab` 直接返回 null（点了不吭声），所以顺序必须先建项目。
  - **视图栈 keep-alive 让 `view-container.spec.ts` 的定位取错屏**：
    `.first()` 现在会命中**首页**那一份文档容器，而它在「模型库」那一档里是
    `hidden` 的 —— 断言报「hidden」，看起来在判宽度档、其实那一档根本没被读到。
    改成按 `[data-view]:not(.hidden)` 取当前可见那一屏（位序会随开过的页签数漂，
    「可见的那一屏」才是这一档真正要问的）。

  ### ② 6 条覆盖率门槛：新代码没有自己的用例（都是「抽了地基忘了配」）

  - **`src/lib/core/repository-row.ts`（`6ccedfd7` 抽的新地基）没有用例** ——
    它正是那一刀「把 15 处 `rows[0]!` 收成一处」的落点，也是它同时修掉两处真 bug
    的地方，自己却没有判据。补 `repository-row.test.ts`（10 条），
    **并当场抓到它自己的一个 bug**：两个出口都写 `if (!row)`，
    而它们是**泛型**的 —— 一个 `T = number` 的调用点传进 `[0]` 会被误判成「缺席」
    并抛内部错误（「数据错了被报成我方故障」）。改成 `row === undefined`；
    `firstRowOfExisting` 那侧误判更重：把一条真记录报成 404 会让调用方**重写一遍**。
  - **`src/lib/markdown/index.ts` 的 `loadMarkdownRenderer()`（`9ab9634e` 新增的按需出口）
    没有用例**。补 3 条：返回两个渲染函数、拿到的函数真能渲染、**与静态出口同源**
    （两条路径产物逐字相同 —— 只判「函数在场」会在有人换一份实现时全绿）。
  - **`src/config/custom-nodes.ts` 的 `isFieldType` 收窄只测了 `false` 那一支** ——
    三个既有 fixture（`"COMBO"` / `"slider"` / `""`）恰好都**不是**合法 `FieldType`，
    于是「认得出 → 原样保留」从未被执行过。而它写死成 `false` 也没人红，
    那正是「所有控件都退化成单行文本框」的形态（界面看着能用，实际下拉框 / 开关 /
    滑块全变输入框）。补正向那一条（七个合法类型逐个走）与反向那条的断言。

  ### ③ bundle 预算 +402 B：两个客户端改动的正当涨幅，走 §13.5.4 例外流程认账

  `098a67a2`（启动页面板露出服务日志）与 `f9249656`（三处 effect 自激成无限请求）
  都是加了客户端代码的真修复，其余 15 次提交全是 docs / gates / scripts（不进产物）。
  +402 B 是它们的正当代价 ⇒ 带 `--allow-increase` 重跑 `--update` 认账
  （不带该旗标时 `--update` 会拒绝抬高，与 `check-overlay-z.cjs` 那批棘轮同口径）。

## Verified

- 全量 e2e：**18 failed → 0**（77 passed / 1 flaky）
- 全量单测 + 覆盖率：**8898 passed / 701 files**、6 条门槛全过（改动前 6 条跌破）
- 产物级护栏：build + 数产物 + 预算 + 宿主冒烟全过
- 三档新鲜度账均已真跑绿并记账：`scripts/.{e2e,full-suite,artifact}-freshness.json`
