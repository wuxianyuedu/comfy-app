## Added

- **`pnpm ship` —— 「分支 → 提交 → push → PR → 等 CI → 绿了合并」这条流程的执行者**
  （`scripts/ship.mjs` 编排层 + `scripts/ship-core.mjs` 纯判定层 +
  `tests/ship.test.ts` + `.qoder/skills/ship/SKILL.md`，规范 §13.6）。
  补的是这仓门禁的**最后一格**：判定层已经很全（`pre-commit` 五组五十步、`pre-push` 自动跑
  `premerge-check.mjs` 并落机器本地证明、平台侧 `质量门禁` 那一趟 build、`base-check.mjs`
  复算主干基线），但**把它们按顺序跑完并如实转述**的那一层此前不存在 —— 每个执行者
  临时手写一遍，于是同一件事长出 N 套走法，而每一套都会在它自己没想到的地方静默判错。
  形状照 `premerge-check.mjs` 那一族（同一个决定的同一种写法）：**合成一条命令，
  并且不发明第二套编排** —— 所有「绿不绿」的结论都来自既有执行者的原值。
- **三条写进代码而不是写进文档的纪律**：
  ① **不发明判定** —— 终态只认 build 的 `data.status` 与 PR 的 `is_merged`；
  ② **退出码三态**（`0` 绿 / `1` 有事实红 / `2` **有一步没跑起来**），且 `2` 压过 `1`，
  与 `premerge-check.mjs` / `base-check.mjs` 同口径 —— 「没拿到测量」与「测量结果是红的」
  混起来就是静默失效；③ **合并是显式动作**，不给 `--merge` 就停在判决处。
- **两处实测踩到的坑被钉成了判据**（不是预防性写作）：
  `cnb` 的非 JSON 输出里 `status:` 出现**两次**（顶格那条是 HTTP 信封，`200` 只说明
  「问到了」），把它当流水线终态读，会把一条从没跑起来的 build 报成成功 ——
  实测因此白轮询 28 次；而同一台节点上会同时有多条 `pull_request` build 在跑
  （列表项里**没有 PR 号可锚**），唯一的归属键是 `sha`。
  所以取数一律走 `cnb … -v` 的 **JSON** 且只读 `data.*`，
  `tests/ship.test.ts` 用**那份真实形状**的样本各钉一条，并配负控制
  （「只有信封字段」必须落 `unknown` ⇒ 退 2，写成 `json.status ?? json.data.status`
  的实现会让正样本照样绿）。
- **顺带被这条对账抓到一个自己的 bug**：`planCommands`（`--dry-run` 打印的命令清单）
  里合并那一行漏了 `-v`，而真执行路径带着 —— 清单与执行分叉。第一次跑判据就红了。
  `planCommands` 本质是命令清单的第二份抄本，这正是要避免的形态，所以**不装作它不是**：
  加了一条「从源码抽 `cnbJson` 的模块+工具对 ⇄ 计划里的同集合」的逐条对账，
  任何一侧改名而另一侧没跟就红；并带一条前置断言（一条都抽不到 ⇒ 提取正则坏了），
  否则两侧同时成空集就会恒绿。

- **被 `check-infra-file-size` 的 900 行硬闸拦下一次，拆成两层**（首版 `ship.mjs` 906 行）。
  拆法不是「砍注释凑数」而是按职责分：`ship-core.mjs` 装**纯判定**
  （把平台/PR 的原文读成三态结论，输入是外部形状），`ship.mjs` 只留**编排与副作用**
  （`main()` / 跑命令 / 写临时文件）。这样平台改字段、加一档状态、把 `data` 从对象
  换成数组时，红只落在 core 那一层 —— 与 `merged-side-loss-core.mjs` +
  `merged-side-loss-git.mjs` 是同一个先例的形状。拆后 318 / 624 行，
  且拆之前先跑「14 个 export 一个不许丢」的对账，不符就中止不写盘。
- **一处 `.ts` 与 `.mjs` 的注解规则差异**（写测试时踩到）：JSDoc 的 `@type` 变量注解
  只在 `.js` / `.mjs` 里被采纳，在 `.ts` 里**被静默忽略** —— 于是
  `/** @type {string[]} */ const calls = []` 在测试文件里等于没写，
  报 `Property 'branch' does not exist on type '{}'` 与一串 `no-unsafe-*`。
  同一份写法在 `ship-core.mjs` 里是对的。测试侧因此改用真的 TS 语法。

- **第一次真跑（拿它交它自己）照出四处缺陷，全部补了判据**。这一节是「为什么必须真跑一遍」
  的现场证据 —— 三条本地门禁全绿、32 条用例全绿，而真跑第一次就退 1：
  - **钩子的话被弄丢了（最重的一条）**。`makeRunner` 只接 `stdout`，而 `git commit`
    被 pre-commit 拦下时钩子把**全部原因写在 stderr** —— 屏幕上只剩一句
    「提交被门槛拦下（exit 1）」，一个理由都没有。一个职责是「如实转述执行者」的
    工具把执行者的话弄丢了，比没有这个工具更糟。修法：runner 带 `stderr`，
    提交与 push 两处改走 `relay()`；用例喂一份 `commitStderr` 断言它出现在输出里。
  - **「这台机器没有 cnb」是假的**。Windows 上 `cnb` 是 pnpm 全局目录里的三个垫片：
    无扩展名那份 node 不认（ENOENT）、`cnb.cmd` 在无 shell 下被 Node 直接拒
    （**EINVAL**，CVE-2021-22940 那批修复的副作用）、没有 `cnb.exe`。而本仓刻意
    `shell: false`（`launcher-core/shell.mjs` 头注第 2 条）。实测
    `usableCommand("cnb").ok` 与 `commandInvocation("cnb")` **都返回否**，
    而同一时刻命令行里 `cnb` 好得很（它刚开了两个单）。
    **出路不是自己摸 PATH、更不是偷偷开 `shell: true`**，而是走已经为 pnpm 解决过
    同一件事的那份唯一实现：`pnpmInvocation(args, {name:"cnb"})` —— 那个 `name` 选项
    就是它通用的一面，别因为函数名里带 pnpm 就另写一份。实测 `viaHost: true`、
    spawn 退 0 打出 1.15.25。可用性判据也随之改成「**真起一次** `--version` 看退码」，
    因为「找得到」与「起得来」在垫片上是两件事。
  - **「单 PR 单变更」那条守卫是恒真的假守卫**。第一版用 `git ls-files changelog.d`
    数碎片，量出来是 **118 份**（整个目录的存量），而本次只带 1 份 —— 于是
    `frags.length === 0` 那一判永远不成立，看起来像在判什么。改成按本次工作树状态数
    （`git status --porcelain -- changelog.d` → 1 份），并补一条用例钉「输出里是 1 份」。
    ⚠️ 顺带一个取数顺序坑：`status --porcelain -- changelog.d` 与全树那一查
    **前缀相同**，替身里若先匹配宽的那条，碎片就永远读到空 —— 用例里把窄的排前面并写了注释。
  - **`--only=poll` / `verdict` / `merge` 是一段没跑却退 0 的假绿灯**。这三段嵌在
    `pull-request` 里面、要用它当场解析出的 PR 号；单独 `--only` 到它们会「一段都没执行」
    然后返回成功。加了显式拒绝（退 2 + 一句可行动的下一动作）与用例，
    并反向钉住早期阶段不被误伤。
  - **修上一条时又改过头，被「同一条分支上的第二次跑」照出来**。把碎片从「整个目录」
    改成「只看工作树」之后，第一次跑提交掉碎片 ⇒ 工作树干净 ⇒ 这条守卫对
    `pnpm ship --merge` **恒假**，于是它在 preflight 就把一条正常的分支拦在门口。
    「单 PR 单变更」是**分支相对上游**的属性，不是工作树的属性 —— 正确的面是
    `git diff --name-only origin/master...HEAD -- changelog.d` ∪ `git status --porcelain -- changelog.d`。
    两次挑错取数面是同一类错、方向相反：① 整个目录 ⇒ 恒真（看着在判其实不判）；
    ② 只看工作树 ⇒ 对第二次跑恒假。**「数一下有多少」这类判据，先看真实仓库里那个数
    是多少再决定取哪个面** —— 这里的 118 与 0 两个读数都是当场量出来的。
    两个面各钉一条用例（分支已提交 1 份 + 工作树干净 ⇒ 放行；工作树带 1 份 ⇒ 读到 1 份）。

## 刻意没做的事（写清楚，别当成已完成）

- **不代写提交信息，不 `git add -A`。** 提交信息是判断（症状 / 读数 / 因果），
  暂存面是「这次包含什么」的声明。树脏而没给 `--message` ⇒ 停在阶段 1 并说明原因。
  这条不是客气：`check-commit-claims.mjs` 会把提交信息里「§x.y 照旧保留」
  「`<path>` 一个字没动」「N 处收到 0」三种句式拿**该提交的树**复核，
  脚本没跑过的判据就不该写进它生成的文本 —— PR 正文因此只填当场量到的
  （碎片标题、`diff --stat`），并有一条用例反向钉住那三种句式不许出现。
- **不重跑 `premerge-check`。** push 钩子已经跑过并落了证明，重跑是分钟级的重复付费，
  且两份结论会开始漂移。这里只**读**那份证明（含 `.git` 是 worktree 指针文件的形态 ——
  直接拼路径会读不到，而那会被报成「钩子没跑」，而它其实跑了）。
- **不进 `docs/standards/launch-and-build.md` §9.5 跨平台动作对照表。** 一旦进表，
  `check-ps1-consistency.mjs` 的 `checkPairs()` 就要求那一行**同时有真实的 `.ps1` 与
  `.mjs`**，等于逼出一个没有任何逻辑的 Windows 壳。它是按需的开发者动作，
  与「质量门禁 / 全量 E2E」同档，那些也没有各自的 `.ps1`。
- **不注册进 `.gate-executor-ledger.json` / `.declaration-readers.json` / 钩子步骤。**
  它是驱动器不是判据：不带 `check-` / `report-` 前缀、不在钩子的 gate-chain 步骤位上，
  所以那三条台账判据扫不到它，也就**不该**登记它（登记 `onDemand` 会连带要求
  `.on-demand-duties.json` 同批改一行，进钩子步骤会连带要求改 `D(N 个判据脚本)` 计数）。
- **不碰 `--force`、不改历史、不删远端分支。**
- **没有**顺手复活 `check-branch-guard.cjs` 那两个自 #623 起没有调用者的服务端形态
  （`--pr-check` / `--merge-commit`）。阶段 0 确实是它们该在的位置，但那会把
  「加驱动器」变成「复活两条判据」，而判据复活要重新看存量 —— 另案。

## 验证

- `tsc --noEmit` 0 错（`scripts/*.mjs` 在 `checkJs` 面上，且本仓开着 `noUncheckedIndexedAccess`
  —— 索引取值一律 `| undefined`，22 条错全部按这个口径改实现，没有在调用侧加 `!` 糊）。
- `tests/ship.test.ts` **33 passed**：`readBuildVerdict`（三档 + 大小写 + 四条负控制）、
  `pickBuildForSha`（并行两条只认 sha / 无命中不退化成「拿最新」/ event 不是 pull_request 不算 /
  同 sha 多条取最新 / 畸形入参不抛）、`asArray`（**null ≠ 空数组**：前者是「没拿到列表」、
  后者会被读成「查过了没有我的」）、`combineShipCodes`（2 压 1 + 三态字面值钉住）、
  `parseArgs`（未知旗标进 `unknown` 而不是被静默忽略 —— 拼错的旗标会被读成「没要那个动作」）、
  `parseSlug`（https / ssh / 取不到回 null 不猜）、`findPullForBranch`（重跑不产生第二个 PR）、
  `planCommands`（计划与执行同集合）、`buildPullBody`（不生成未经验证的声明句式）。
- **`main()` 用注入的假执行者跑，断言的是「它有没有伸手改世界」**：dry-run 之下
  `git add` / `commit` / `push` / `checkout` / `fetch` / `post-pull` / `merge-pull`
  七种写动作**各调 0 次**（而只读探测照做 —— 不读就没法给出计划）；`cnb` 不在时
  本地照跑、平台一个调用都不发、退 `2`；未知旗标退 `2` 且**一次调用都没发出**；
  `--only` 落在 `poll` / `verdict` / `merge` 上被拒（这三段要用本次跑里解析出的 PR 号，
  单独跑会退化成「一段都没跑却退 0」的假绿灯），同时反向钉住早期阶段不被误伤。
- **一处自己写的假话被现场跑否掉了**：头注与 Skill 都写着 `--dry-run`「恒退 0」，
  而真跑 `node scripts/ship.mjs --dry-run` 在 `master` 上退的是 `1`。
  **改的是声明不是行为** —— 一个会藏掉阻塞事实的预览比不预览更糟；那句撤成了
  「不执行任何写动作，但阻塞照报」，并补一条**负控制用例**钉住「在 master 上 ⇒ 退 1」，
  免得以后有人把「恒退 0」又当直觉加回来。
- `pnpm ship --dry-run` 在本检出跑过：打印的清单里每条 `cnb` 调用都带 `-v`；
  `--merg` / `--only=bogus` 两条误用路径各退 `2` 并给可读的出口。
- 未注册新 token / 新 variant / 新依赖，因此 `@theme` 名快照与 `docs/DESIGN.md` 不受影响。
