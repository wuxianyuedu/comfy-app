## Fixed

- **`pnpm ship` 在本仓从第一次跑起就没工作过** —— 它把远端名**写死成 `origin`**，
  而本仓按硬规则 6 / §13.6 只有一个叫 `cnb` 的远端。不是一处而是五处：
  `git remote get-url origin`（取 slug）、`git diff origin/master...HEAD -- changelog.d`
  （取分支带进来的碎片）、`git push -u origin <分支>`、`git fetch origin master`、
  `git cat-file -e origin/master:<碎片>`（合并后回读主干顶端）。
  五条命令全部失败，而**每一处失败都长得像「答案为空」**：碎片那一查拿到空串，
  preflight 于是报「没有 changelog.d 碎片 ⇒ 单 PR 单变更那条不成立」——
  一条听起来完全正当的假结论，真原因是「这条比对没有事实源」。
  实测入口：`pnpm ship --dry-run` 在一条**已经带着两份碎片提交**的分支上报
  「碎片 0 份」并退 1。
- 修法是把「远端叫什么、主干基线是哪条」收成一份可判的纯函数
  （`ship-core.mjs` 的 `resolveUpstream`），三档来源按事实强弱排：
  ① HEAD 自己的上游 `@{u}`（git 已经知道的事，不另推）；② 没有上游但只有唯一远端
  ⇒ 推 `<远端>/master`，**打印时标明来源**（默认分支不叫 master 时它会偏，而偏了会被
  下面那一格当场抓住）；③ 既没上游又是多远端且无 `origin` ⇒ 给 `null`，
  调用方按「没有执行者」处理。五处调用全部改用它，PR 的 `--base` 也从解析出的
  **分支名**取（不再写死 `master`），`planCommands` 的 dry-run 计划跟着同一份事实 ——
  计划与执行两头写同一条错时，dry-run 看起来完全正常。
- 新增「基线引用必须**真的存在**」那一格：`rev-parse --verify --quiet <基线>` 退非 0 ⇒
  **退 2 并说「没有事实源」**，明确不退成「没有碎片」那条红。判据 `tests/ship.test.ts`
  加 4 格（`resolveUpstream` 三档各一 + preflight 那一格的话术与退出码），
  并把夹具从「任何 `get-url` 都回一条 URL」改成**按远端名回答**——
  原夹具对 `origin` 也回话，所以这条链从没被真判过（37/37 现在全绿）。
- 位置也判了一次：解析最初放在两道守卫**之前**，被「未知旗标 ⇒ 一条外部命令都不许伸出」
  那格当场抓住（拼错一个旗标不该去摸 git）。移到守卫之后、阶段 0 之前。
