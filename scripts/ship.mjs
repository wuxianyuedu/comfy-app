#!/usr/bin/env node
/**
 * ship.mjs — 「从工作树到 `master`」的**编排**入口（规范 §13.6）。
 *
 * ── 为什么要有它 ────────────────────────────────────────────────
 *
 * 本仓的**判定层**已经很全：`pre-commit` 那批形态与静态判据（**默认档跑哪些会随治理线变**，
 * 全套另有 `COMFY_HEAVY_GATES=1` 那一档，见规范 §13.5.25 —— 所以这里不抄组数与步数）、
 * `pre-push` 自动跑
 * `premerge-check.mjs` 并落一份机器证明、平台侧 `质量门禁` 那一趟 build、
 * `base-check.mjs` 复算主干基线。缺的是**把它们按顺序跑完并如实转述**的那一层 ——
 * 它此前由每个执行者临时手写一遍，于是同一件事长出 N 套走法，而每一套都可能
 * 在它自己没想到的地方静默判错。
 *
 * 本脚本的形状照 `premerge-check.mjs` 那一族（同一个作者决定的同一件事）：
 * **合成一条命令，并且不发明第二套编排** —— 所有「绿不绿」的结论都来自既有执行者
 * 的**原值**，脚本一次也不自己判。
 *
 *   | 要做的事            | 谁在做（既有实现，本脚本只调用 / 只读它的产物）              |
 *   | ------------------- | ----------------------------------------------------------- |
 *   | 不在 master 上直提  | `check-branch-guard.cjs`（组 0，由 `git commit` 触发）       |
 *   | 提交门槛            | `.githooks/pre-commit`（由 `git commit` 触发；阶段 0 只预跑它的 D0 只读子集，ISSUE #3200） |
 *   | 合并前固定动作三段  | `.githooks/pre-push` → `premerge-proof.mjs`（由 push 触发）  |
 *   | 「红是我的还是主干」| `base-check.mjs`（本脚本在 CI 红时调它，不自己归因）         |
 *   | 本检出有没有实例在跑 | `launcher-core/port-reap.mjs` 的 `runningAppInstances()`（硬规则 9）|
 *   | 真要把那批进程收掉   | `scripts/reap-process.mjs` → `kill-process-tree`（硬规则 3，整棵树）  |
 *   | 流水线终态          | 平台 build 的 `data.status`（`cnb … -v` 的 JSON）            |
 *   | 合没合上            | PR 的 `is_merged` + **回读解析出的主干基线顶端**            |
 *
 * ── 模块形状（一份 900 行硬闸装不下整条链，而按行数切会把因果切散）──────
 *
 *   · `ship-core.mjs`     —— **判断**：参数、阶段表、平台 JSON 里哪一格才是终态。
 *     纯函数，不起进程、不读文件之外的事实。
 *   · `ship-codes.mjs`    —— **退码表（唯一出处，ISSUE #3083）**：`CODE` 常量与
 *     码 ↔ 语义对账表。看到退码就知道是哪件事；别处不许写魔数。
 *   · `ship-stage.mjs`    —— **「走到哪了」阶段进度行（唯一出处，ISSUE #3083）**：
 *     `[ship] ▶ <阶段> | key=value` 的排版，与冲突面的 merge-tree 只读探测。
 *     进度说走到哪，退码说结果分类，两套信息互不替代。
 *   · `ship-exec.mjs`     —— **效应适配**：`cnb` 垫片怎么起、stderr 怎么接、
 *     一次性临时文件落在 git 目录哪儿。只因宿主而变。
 *   · `ship-platform.mjs` —— **平台侧三段 + 阶段 8 分支清理**：PR / verdict / 合并并回读、删 ref 那一格。
 *     只经注入的 `run` 摸世界，所以整段可被假执行者跑完。
 *   · `ship-poll.mjs`     —— **轮询那一格**（阶段 4）：跟着「一条 build 怎么被读」动，与上面三段
 *     「平台对我们动作的应答」不是一个方向（ISSUE #2258 定的落点）。
 *   · `ship-reap.mjs`     —— **进程那一格**：本检出的归属读数与 `--reap` 的收尾回收。
 *     两半都不自己判 —— 归属只问 `launcher-core/port-reap.mjs` 的 `runningAppInstances()`
 *     （硬规则 9 唯一实现），回收只发 `scripts/reap-process.mjs`（硬规则 3 唯一入口）。
 *   · `ship-ticket.mjs`   —— **单子那一格**：碎片挂在哪个号上、谁提的、按什么优先级。
 *     与「外部执行者的形状」不同的变化方向，所以不在 `ship-core`（叠一起已越过 900 行硬闸）。
 *   · `ship-pull-body.mjs`—— **PR 正文那一格**：碎片清单 + 碎片原文 + `git diff --stat` 的摘要与封顶。
 *     它只回答「发给平台的正文长什么样」，与 `ship-core` 那些「外部执行者的形状」各自变化；
 *     #2248 落地时 `ship-core` 又到了 906 行，按上面 #2189 那条同一口径拆（拆法按职责）。
 *   · `ship-pr-body.mjs`  —— **正文注入那一格**（`--pr-body-file`）：建 PR 与复用 PR 时的
 *     整篇拼装、长度封顶、`patch-pull` 写入与独立回读。拼装在 `ship-pull-body.mjs`，
 *     取数与写平台在这里 —— 两半各自变化，合一起会顶穿 `ship-platform.mjs` 的 900 行。
 *   · `ship-local.mjs`    —— **本地两段**：commit 与 push（含工作树三列状态的读法）。
 *     不碰 cnb、不需要平台回读，动的是本地 ref 与远端同名分支 —— 与 `ship-platform` 那几段
 *     正相反。（搬出去的直接原因是 #2189：加上「只补关」那格之后本文件 928 行，
 *     被 `check-infra-file-size.cjs` 的 900 硬闸拦下 —— 那一闸说的是「出口只有一个：拆」，
 *     拆法按职责、不按行数，见该模块文件头。）
 *   · `ship-close.mjs`    —— **关单那一格**：要不要关、关哪几张、凭什么关（本轮验真合并 /
 *     平台侧落地证明），以及关完的独立回读。它跟着「单子的落地证明口径」动，不跟 build 状态机走；
 *     叠进 `ship-core` 会把它推过 900 行（#2199 现场量的 917 行）。
 *   · `ship-args.mjs`     —— **命令行那一层**：`parseArgs` 认哪些旗标、号「像不像号」只在这一处判。
 *     它跟着「命令行长什么样」动，而 `ship-core` 跟着「外部执行者的读数形状」动（#2491 拆它时
 *     `ship-core` 已 877 行、加上 `--as-merged` 就是 907 —— 同一道 900 硬闸、同一个出口：拆）。
 *   · `ship-claim.mjs`    —— **单子的领取 / 结束释放 / 我的领取列表**：`--claim` /
 *     `--release` / `--claims`，以及关单之后那一步收尾评论与撤标签。它跟着「单子上
 *     谁在做」这一维动，与合并那一路互斥。
 *   · `ship-preflight.mjs`—— **阶段 0**：本检出自己的读数与本地门（分支守卫、碎片、
 *     单子读数、实例归属、依赖新鲜度、D0 预跑）。它判的都是「这一份检出」的事实，与平台侧那几段
 *     正相反；叠在本文件里会把装配层推过 900 行（第二次撞上，首次见 #2189）。
 *   · `ship-preflight-d0.mjs`—— **D0 预跑的机制层**（ISSUE #3200）：钩子 D0 步骤行的
 *     解析 / 选择 / 执行 / 读数排版，无退出码；接线在 `ship-preflight.mjs`。清单只有一份
 *     出处 —— `.githooks/pre-commit` 的 D0 组本身，这里不抄第二份（钩子加一步，预跑自动跟上）。
 *   · `ship-standalone.mjs`—— **与主流程互斥的单件动作**：`--whoami` / `--diagnose` /
 *     `--stage-log` / `--gh-logs` / `--rerun-ci` / `--branches` / 单子的领取与结束 / 只补关。它们的共同形状是
 *     「一次只做一件、不进主流程」，变化方向也不在阶段顺序上 —— 加一个独立动作不动阶段表。
 *     搬出去的直接原因：#2504 量的 898 行（900 硬闸余量 2 行，同一出口：拆）。
 *   · `ship-stage-log.mjs`  —— **`--stage-log` 的执行体**（ISSUE #2455）：按格名反查 `stageId`
 *     再取那一格的正文。取数与归一不写第二份，全走 `ci-build-readout.mjs`（与 `--diagnose`
 *     是同一个读者的两个入口，同一跑不许给出两种答案）。
 *   · `ship-gh-logs.mjs`  —— **GA 失败日志回读**：`--gh-logs <run-id|pr号>` 与判红自动触发。
 *     取数全走 `ci-github-verdict-logs.mjs`（重试/超时/脱敏不写第二份），本模块只认目标、
 *     排版（run / job / step / 全部 `##[error]` / 窗口 / 一行归因）与落盘绝对路径。
 *   · 本文件              —— **装配**：阶段顺序、读数的落点，
 *     以及「谁跑了、各段结论是什么」的那一处记账（`codes` + `finish`）；
 *     收尾回收挂在 `main` 的唯一出口上（一轮可以从七八个出口结束，见那里）。
 *
 * 拆的是**变化方向**：加一个阶段只动本文件与 `ship-platform.mjs` / `ship-poll.mjs`，
 * 改 Windows 垫片只动 `ship-exec.mjs`。对外行为、命令行、退出码、打印原文一字不改。
 *
 * ── 三条写进代码的纪律（不是文档承诺）──────────────────────────
 *
 * 1. **不发明判定。** 终态只认两个原值：build 的 `data.status`、PR 的 `is_merged`。
 *    信封上那个 `status: 200` 是 **HTTP 状态**，与「流水线过没过」毫无关系 ——
 *    把它当结论读，会把一条从没跑起来的 build 报成成功（实测踩过：非 JSON 输出里
 *    两个字段同名，`grep '^status:'` 恒取到 200，于是白轮询几十次）。
 *    所以取数只走 `cnb … -v` 的 **JSON**，且只读 `data.*`。
 * 2. **退码分型表（0–7），唯一出处 `ship-codes.mjs`，与 `premerge-check.mjs` /
 *    `base-check.mjs` 的三态口径兼容**（ISSUE #3083）：`0` 走到终态且事实为绿；
 *    `1` **有事实是红的**；`2` **没跑起来（泛化兜底）**；`3`–`7` 是对「没跑起来」
 *    的细分（冲突 / CI 无终态 / 读数缺失 / 守卫拦住 / 本地前置）—— 看到退码就知道
 *    是哪件事。合码口径不变：「没跑起来家族」（≥2）压过 `1`，`1` 压过 `0` ——
 *    「没拿到测量」与「测量结果是红的」是两件事，混起来就是静默失效。
 * 3. **合并是显式动作。** 默认止于阶段 5（打印下一动作）。要合就 `--merge`
 *    （或 `--mode auto` / `--mode confirm` —— 那是打包旗标的显式别名，#3512；
 *    别名由人点名才算授权，展开后与逐枚旗标同义，不发明判定）。
 *
 * ── 它**不做**什么 ─────────────────────────────────────────────
 *
 *   · **不代写提交信息**。提交信息是判断（症状、读数、因果），不是排版。
 *     树脏而没给 `--message` ⇒ 退 1 并说清为什么停在这里。
 *   · **不 `git add -A`**。暂存面是「这次提交包含什么」的声明，要由调用方给
 *     （`--add <path>` 逐个点名，或你自己先 `git add`）。它会**打印**暂存了什么、
 *     以及还有什么没暂存。
 *   · **`--add` 在场时暂存面是封闭的**（ISSUE #3597）：`git commit` 吃整个 index，所以
 *     「点名了这些」与「index 里还有别的」是两件事 —— 调用之前就已暂存的文件默认让这一笔
 *     **退 2** 并逐个念出路径；确认要一起走才显式 `--allow-staged`。
 *   · **不重跑 `premerge-check`**。push 钩子已经跑过并落了证明；重跑是分钟级的
 *     重复付费，且两份结论会开始漂移。这里只**读**那份证明。
 *   · **不生成因果句进提交信息**：`check-commit-claims.mjs` 会把「§x.y 照旧保留」
 *     「`<path>` 一个字没动」「N 处收到 0」三种句式拿提交树复核。所以 PR 正文
 *     只填它**量到的**（diffstat、碎片标题、碎片原文、失败 stage 名），不填推断。
 *   · **不碰 `--force` / 不改历史 / 不删分支**。
 *   · **不替 issue 写内容**。`--close-issue` 只做一件机械事：把点名的单子置
 *     `closed / completed`，然后**独立回读** `state` / `state_reason` /
 *     `closed_at` 三件原值打出来。号有两种来源（本轮落地那一行的标题本体 / 人在命令行
 *     上点名），但「凭什么关」只有一条线：没有落地证明就不关（`ship-close.mjs` 那段）。
 *     那条「已落地 + 读数 + 因果」的记录评论是判断，
 *     与提交信息同一档，不由编排层生成 —— 生成出来的那句话必然是一句
 *     「它说它做了」，而这一族存在的意义恰恰是不采信这种话。
 *   · **不默认杀进程。** 本检出的实例在不在跑，阶段 0 每轮都念一行（归属取自硬规则 9 那条
 *     判据，是**读数**、不参与退码）；要收得点名 `--reap`，而且**只收 `via:"port"` 那批**——
 *     `via:"session"` 是「编排器还活着」，那不是残留，停它要走编排器自己的收尾路径。
 *     既不泛匹配 `node.exe` 也不按端口反查（硬规则 3：各写一遍正是历史上误杀与留孤儿的根因）。
 *   · **不替你立案，也不替你凑一个号**。阶段 0 会把「这次带来的碎片各挂在哪个号上」
 *     念出来，其中段落是 `## Fixed` 而号是 `0` 的那几份额外点一句「先立案再改」
 *     （规范 §13.10.9）—— 那是**读数**，一次也不参与退码。做成硬闸的必然后果是随手
 *     挂一张别人开着的单子，而 §13.10.8 记的就是那次事故（挂错号比不挂更贵，
 *     且号只是个字符串、没有判据会红）。
 *   · **不造分支名，也不批量清分支**。`--branch` 只补「动 ref」那半件机械事，名字由人给
 *     （`feat/…`、`fix/<issue号>-…` 是本仓习惯，不是脚本能推的事实 —— 猜错会让这条变更
 *     顶着另一个身份进评审与后续引用）；`--clean-branch` 只删**这一次跑的那条**分支，
 *     「把所有已合并分支一次收掉」需要另一套判据（squash 形态下 `git branch -d` 的祖先
 *     判据恒假），那不在本脚本的动作面里。也不碰 `git reset --hard`：本地 `master` 上
 *     若有误提交，AGENTS 硬规则 6 那三步是给人执行的。
 *
 * ── 用法 ───────────────────────────────────────────────────────
 *
 *   pnpm ship                                  # 到「CI 出终态 + 打印下一动作」为止
 *   pnpm ship --message "…"                    # 需要它代为提交时给出提交信息（单行）
 *   pnpm ship --message-file .git/msg.txt      # 多行提交信息走文件 —— `pnpm run` 会把
 *                                              #  argv 里的真换行改写成字面量 \n，多行别从命令行进
 *   pnpm ship --add src/a.ts --add changelog.d/0-x.md --message "…"   # 由它代为暂存（逐个点名，不 -A）
 *                                              #  **点名即封闭面**：index 里另有未点名的
 *                                              #  文件 ⇒ 退 2 并逐个念出来（ISSUE #3597）
 *   pnpm ship --add src/a.ts --allow-staged     # 显式放行上面那一格（只有确认它们该
 *                                              #  一起走时才给；不给就是不许）
 *   pnpm ship --no-commit                       # 「这一笔我自己已经提交（甚至已推送）过 ⇒
 *                                              #  跳过提交段、不看工作树，HEAD 原样进推送段」——
 *                                              #  说出来的判定（ISSUE #3619 / #3676）：并行检出的
 *                                              #  工作树上挂着别的会话的常驻脏文件，「哪些是我的」
 *                                              #  没有可靠判据，由人点名跳过，脚本不去猜。
 *                                              #  与 --add / --message / --message-file /
 *                                              #  --allow-staged 任一同行 ⇒ 退 2（没有提交段，
 *                                              #  那些旗标没有对象）。纯合并那一跳
 *                                              #  （--mode auto --no-commit）靠它免掉重报 --add。
 *   pnpm ship --title "…"                      # 覆盖标题（默认取分支第一笔非常规提交）
 *   pnpm ship --branch feat/x                  # 当前没有可用分支时先把分支建出来再往下走
 *                                              #  （名字只能人给：脚本不从 issue 号/标题里造）
 *   pnpm ship --merge                          # 允许在 CI 绿时执行 squash 合并
 *   pnpm ship --merge --close-issue            # 合上之后关掉落地那一行点名的 issue
 *                                              #  （显式才做；只跟在**验真的合并**之后，
 *                                              #   误带在没有合并的那一跳上 ⇒ 退 2 并说明）
 *   pnpm ship --close-issue 2179               # 只补关：人点名的号**不要求本轮合并**，
 *                                              #  前提换成「平台查得到它随某条已合并 PR 落地」
 *                                              #  （查不到 ⇒ 退 2；「查不到」不等于「没落地」）
 *   pnpm ship --merge --close-issue 2179       # 本轮号（标题**末尾的认领形态** `(#N)`）+ 人点名的号，
 *                                              #  并集去重。正文里裸写的 `#730` 不算认领 ——
 *                                              #  那是引用，只念一行「没关」并给人点名的出口
 *                                              #  （ISSUE #2646：PR #2642 的标题让一张早已
 *                                              #  closed 的邻居免了事故，在世的就是被静默关掉）
 *   pnpm ship --close-issue 2488 --as-merged 2487
 *                                              # 补关的第二条凭据入口（ISSUE #2491）：每日档自动
 *                                              # 立案的单子里没有 (#号) 可反查 ⇒ 人只点名**一条凭据**，
 *                                              # 合并与否仍由脚本回读 data.is_merged：true ⇒ 关，
 *                                              # false ⇒ 退 1（前提被推翻），取不到 ⇒ 退 2。
 *                                              # 它**不是** --force-close，也不替代本轮验真的合并。
 *   pnpm ship --merge --clean-branch           # 合上之后删掉**这次那一条**分支（远端 + 本地）
 *   pnpm ship --mode auto                      # 全托管：= `--merge --close-issue --clean-branch` 的
 *                                              #  **显式别名**（一次点名授权整组；展开发生在解析层，
 *                                              #  结论仍只认 build 的 data.status 与 PR 的 is_merged）
 *   pnpm ship --mode confirm                   # 同一组动作，但合并 / 关单 / 删分支每步先问 [y/N]
 *                                              #  （回答不是 y ⇒ 未授权：跳过该动作、念出手动出口，
 *                                              #   收尾结论行前汇总；EOF / 非交互 fail-closed；
 *                                              #   CI 已红的那一跳不问合并，照旧退 1）
 *                                              #  词表只有 auto / confirm，词表外 ⇒ 退 2 不静默收下
 *   pnpm ship --reap                           # 这一轮结束时收掉本检出**端口上那批**残留进程
 *                                              #  （阶段 0 每轮都念一行归属读数；`via:"session"`
 *                                              #   那一档不归这里收，见 `ship-reap.mjs`）
 *                                              #  （同样是显式动作；两边各自独立回读，
 *                                              #   回读没跑起来落 2 而不是「已删」；不批量清）
 *   pnpm ship --dry-run                        # 只打印将要执行的命令，一条都不执行（阻塞照报）
 *   pnpm ship --only=preflight               # 单跑阶段 0 看读数字段（其余段都排在它后面，
 *                                            #  单跑会落不出任何结论 ⇒ 退 2，见 `finish`）
 *   pnpm ship --no-wait                        # 建完 PR 就停，不轮询 build
 *   pnpm ship --no-preflight-d0                # 关掉阶段 0 的 D0 预跑（ISSUE #3200；默认开：
 *                                              #  提交前把钩子 D0 组的只读形态判据先跑一遍，
 *                                              #  所有红一次报齐 ⇒ 落 1 停手，与提交钩子同权。
 *                                              #  预跑是双付，不愿付就点名这枚；提交时钩子照判）
 *   pnpm ship --whoami                         # 只读自查：这一份检出的留痕短名 +
 *                                              #   手工写平台文字 / 建 PR 后补标签的粘贴命令
 *                                              #   （一次也不碰平台，不改任何状态）
 *   node scripts/ship-result.mjs              # 只读回读：上一次 ship 跑到哪、给了什么结论
 *                                              #   落盘在 .git/ship-result.json（本机、不入库）；
 *                                              #   后台完成不保证唤醒 ⇒ 下一轮先读它再决定动作
 *   pnpm ship --claim 2187                     # 领取单子：评论「已接单」+ 打 `处理人:` 标签（写后回读）
 *   pnpm ship --release 2187                   # 结束处理：评论「开发结束」+ 撤 `处理人:` 标签（先评论后撤）
 *   pnpm ship --claims                         # 列出自己领取中（state=open）的单子
 *   pnpm ship --branches                       # 只读：逐条本地分支给「落地了没有」的读数 ——
 *                                              #   判据只有 PR 的 `is_merged` 原值（`git diff
 *                                              #   master…branch` 与 `branch -d` 在 squash 拓扑下
 *                                              #   恒假，不是判据，见 `scripts/ship-branches.mjs` 文件头）。
 *                                              #   它一次也不删；与任何显式动作同行退 2
 *   pnpm ship --new-issue "fix(ship): …" --issue-body-file .git/issue.md --priority P1
 *                                              # 一步建单：create-issue（正文文件 + 开头署名）→
 *                                              #   补 `提单人:` 标签 → 独立 get-issue 回读；
 *                                              #   标题与正文是判断，脚本不代写
 *   pnpm ship --comment 2719 --body-file .git/comment.md
 *                                              # 往已有单子补一条读数：post-issue-comment（正文文件 +
 *                                              #   开头署名）→ 独立 list-issue-comments 逐字回读；
 *                                              #   正文只从文件来（`--issue-body-file` 是建单那格）
 *   pnpm ship --pr-body-file .git/pr.md        # 建 PR 时把这份正文注入到自动事实段**之前**
 *                                              #   （碎片清单 + diffstat 在后，用分隔线隔开）；
 *                                              #   复用已有 PR 时**整篇更新**（给了就覆盖、不给完全不动）；
 *                                              #   不自动加 `Closes`（有就念一行提示，不改写）
 *   pnpm ship --diagnose [sn]                  # 只读：CI 红了就看那一跑的失败格 + 失败行 +
 *                                              #   末 40 行 + 完整日志链接（不给号按 HEAD 归属）
 *   pnpm ship --diagnose --dry-run             # 只打印它会读的那三条命令
 *   pnpm ship --stage-log [<sn>] <格名|格 id>   # 只读：念出**某一格**的日志正文（剥 ANSI、带完整
 *                                              #   日志行号）—— 绿跑也能用；按格名反查 stageId，
 *                                              #   认不出/命中多格都退 2，不替你挑一格
 *                                              #   （#2445 那类「弃用警告清零没有」的验收只能看绿跑）
 *   pnpm ship --gh-logs 3195                  # 只读：按 PR 号回读 GA 失败日志 —— run / 失败 job / 失败 step /
 *                                             #   全部 `##[error]` / 失败窗口（head 20 + tail 120，写明省略行数）/
 *                                             #   一行结论；全量日志落系统临时目录并打印绝对路径
 *   pnpm ship --gh-logs run:4242               # 按 run id 直取；`run:` / `pr:` 可消歧，裸数字按位数判。
 *                                             #   ship 轮询判红时也会自动回读一次（无令牌只念一行跳过）
 *                                             #   #3667 起：判绿按需档（GA_LOG_SCOPE=all）也把日志搬进 CNB；
 *                                             #   `--gh-logs pr:<号>` 站内没有 relay 时自己发起搬运并等回读，
 *                                             #   一条命令拿到结果，零 api.github.com（不用先敲 start-build）；
 *                                             #   代发那一跳是平台写动作，--dry-run 只念计划不发
 *   pnpm ship --rerun-ci                       # CI 挂了想重跑：在当前 PR 分支推一个空提交触发新 build（平台侧没有 PR 重跑入口，
 *                                            # 不去 cnbcli 翻）。它同时带上 COMFY_INTENTIONAL_EMPTY_COMMIT —— D0 里有两步读当场暂存区，
 *                                            # 空索引本来被它们读成「取不到判决面」；口径与反滥用见规范 §13.5.5 末段
 *
 * 阶段名：preflight · commit · push · pull-request · poll · verdict · merge · close-issue · clean-branch
 * （`close-issue` 带号时能单跑 —— 那是「补关」那一路，要平台侧的落地证明；不带号或
 * `clean-branch` 不能单跑：它们要的是合并那一段的验真结果。）
 */
import fs from "node:fs";
import process from "node:process";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";
/* 旗标解析在 `ship-args.mjs`：它跟着「命令行长什么样」动，而 `ship-core` 跟着「外部执行者的
 * 读数形状」动（ISSUE #2491 把这一层拆出去的那条理由写在文件头）。 */
import { flagConflicts, parseArgs } from "./ship-args.mjs";
import { expandMode, makeStdinConfirm, runFinalStages } from "./ship-mode.mjs";
import { CODE, codeTag, combineShipCodes, parseSlug, resolveUpstream } from "./ship-core.mjs";
import { makeRunner, short, writeScratch } from "./ship-exec.mjs";
import { reportStage } from "./ship-stage.mjs";
import { createShipResultSink } from "./ship-result.mjs";
import { handleFromProcessEnv, readDevHandleWithSource } from "./ship-ticket.mjs";
import { reapCheckoutInstances, readAppInstances } from "./ship-reap.mjs";
import { createOrReusePull, reportVerdict } from "./ship-platform.mjs";
import { pollUntilTerminal } from "./ship-poll.mjs";
import { startProgress } from "./progress-heartbeat.mjs";
import { runCommitStage, runPushStage } from "./ship-local.mjs";
import { runPreflightStage } from "./ship-preflight.mjs";
import { runGhLogsOnRed } from "./ship-gh-logs.mjs";
import { runStandaloneAction } from "./ship-standalone.mjs";
import { mentionsCloses } from "./ship-pull-body.mjs";

/**
 * 对外入口：跑一遍编排，**无论走到哪个出口都清掉自己写的临时文件**。
 *
 * 提交信息与 PR 正文都是当场拼出来的原文，留在盘上没有用处 ——
 * 而 `.workbuddy/` 是 gitignored，所以「忘了删」不会进历史、只会一直堆着。
 * 实测前几轮真跑就在 `.workbuddy/` 里留了 3 份提交信息。
 *
 * 清理放在 `finally` 而不是每个调用点后面，是因为**最常见的失败路径本身就是一个
 * 提前 return**（钩子拦下提交时 `return finish(codes)` 就发生在写完临时文件之后）——
 * 「用完顺手删一句」在这种形状下照样漏，而且漏的恰好是没人回头看的那几次。
 *
 * @param {Parameters<typeof runFlow>[0] & { shipResultResolve?: (cwd?: string) => string | null }} [deps] 注入点
 *   （`shipResultResolve` 只由这一层消费：落盘回读点的落点；默认不给 ⇒ 不写盘，
 *    见下面 `main()` 里「不污染真实检出」那条说明）
 * @returns {Promise<number>} 进程退出码（三态）
 */
export async function main(deps = {}) {
  /** @type {string[]} */
  const tmpFiles = [];
  let code;
  const root = deps.root ?? process.cwd();
  /* 落盘回读点挂在 `main()` 的唯一出口上（ISSUE #3206）：一轮可以从七八个出口
   * 结束，挂在某个阶段里就总有「哪条路径忘了写」这一格。sink 一创建就先写一笔
   * `status=running`，此后每笔 log 同步追加 —— 被 SIGTERM 也留得下停在最后一行
   * 的读数。写盘失败一律吞掉：这一格是读数，不是判据。
   *
   * 落点**必须由调用方显式给**：编排层默认不落盘。几十条 `main({...})` 注入用例
   * 共用本仓真实检出，若默认把 `.git/ship-result.json` 写了，测试跑完「上一次
   * ship」就成了假读数；`tests/ship.test.ts` 还有一条 `readdirSync(gitDir)` 必须
   * 为空的回收断言会当场红。只有 CLI 入口传真实 `resolveGitDir` 才写。 */
  const { shipResultResolve, ...flowDeps } = deps;
  const sink = createShipResultSink({
    root,
    args: deps.args ?? process.argv.slice(2),
    resolve: shipResultResolve ?? (() => null),
  });
  const log = sink.wrapLog(deps.log ?? ((s) => process.stdout.write(`${s}\n`)));
  try {
    code = await runFlow({ ...flowDeps, log }, tmpFiles);
  } catch (error) {
    sink.fail(error);
    throw error;
  } finally {
    for (const p of tmpFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // 已经被删 / 从来没写成：清理尽力而为，不该改变这一次编排的结论。
      }
    }
  }
  /* 收尾回收挂在**唯一出口**上，而不是某个阶段末尾：一轮可以从七八个出口结束
   * （门槛拦下、基线取不到、cnb 不在、轮询到顶…），挂在阶段里就总有「哪条路径忘了收」
   * 这种形态 —— 而那恰好是这一格要防的事。`--dry-run` 只进计划，不伸手。 */
  const opt = parseArgs(deps.args ?? process.argv.slice(2));
  if (opt.reap && !opt.dryRun) {
    const run = deps.run ?? makeRunner(root);
    const before = code;
    code = combineShipCodes([
      code,
      await reapCheckoutInstances({
        root,
        log,
        run,
        read: deps.readInstances ?? readAppInstances,
      }),
    ]);
    /* 合并进来之后先前那句「结论：exit N」就可能过期 —— 那正是这一族最反对的形状
     * （一句声明被同一轮的下一行推翻），所以只在结论**变了**的时候改口一次。 */
    if (code !== before) {
      log(
        `[ship] 含收尾回收的最终结论：exit ${code}` +
          `（上面那行 exit ${before} 是回收之前的结论）`,
      );
    }
  }
  sink.finish(code);
  return code;
}

/**
 * 主编排。所有外部效应都从 `deps` 注入，所以它可以被完整单测（见 `tests/ship.test.ts`）。
 *
 * @param {{
 *   root?: string,
 *   run?: (cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   probeCnb?: ()=>boolean,
 *   resolveGitDir?: (cwd?:string)=>string | null,
 *   log?: (s:string)=>void,
 *   sleep?: (ms:number)=>void,
 *   fetchImpl?: typeof fetch,
 *   now?: ()=>number,
 *   args?: string[],
 *   env?: Record<string, string | undefined>,
 *   readInstances?: (root: string) => Promise<{running?: boolean, pids?: number[], via?: string | null}>,
 *   confirm?: (label: string, detail?: string) => Promise<boolean>,
 * }} deps 注入点（由 `main` 总是给全，所以这里不标可选 —— 标了会让后面那个
 *    必需参数报 TS1016「required 不能跟在 optional 之后」）
 * @param {string[]} tmpFiles 临时文件回收清单，由 `main` 建并在 `finally` 里清
 * @returns {Promise<number>} 进程退出码（三态）
 */
async function runFlow(deps, tmpFiles) {
  const root = deps.root ?? process.cwd();
  /** 进程环境是外部输入，与 `run` / `probeCnb` 同一档注入：留痕短名从它读，
   *  用例靠这一格钉住「有 handle / 没 handle」两种现场，而不随开发机的 `.env` 漂。 */
  const env = deps.env ?? process.env;
  /** git 目录怎么解析：默认那份唯一实现，测试里指到临时目录。 */
  const resolveDir = deps.resolveGitDir ?? resolveGitDir;
  /** 写一份临时文件到 git 目录并**登记待回收**；没有落点时回 null（不往工作区猜）。 */
  const mkTmp = (/** @type {string} */ name, /** @type {string} */ text) => {
    const p = writeScratch(root, name, text, resolveDir);
    if (p) {
      tmpFiles.push(p);
    }
    return p;
  };
  const run = deps.run ?? makeRunner(root);
  const opt0 = parseArgs(deps.args ?? process.argv.slice(2));
  /** 模式展开（#3512）：`--mode auto` / `confirm` 是打包旗标的显式别名，展开后与
   * 人亲手给了那三枚旗标完全同义。展开发生在解析层之后、所有阶段之前 ——
   * standalone 分派（只补关那一路认 `closeIssue && !merge`）与互斥清单读到的
   * 都已经是展开后的旗标面。词表外的值留在 `modeBad` 里，由下面那道检查拦。 */
  expandMode(opt0);
  const opt = opt0;
  /** cnb 在不在：**真起一次** `--version` 看退码。不按「PATH 里有没有那个名字」判 ——
   *  在 Windows 垫片上「找得到」与「起得来」是两件事（见 `ship-exec.mjs` 的 `cnbSpawn`）。 */
  const probeCnb = deps.probeCnb ?? (() => run("cnb", ["--version"]).status === 0);
  const log = deps.log ?? ((s) => process.stdout.write(`${s}\n`));
  const sleep = deps.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
  const now = deps.now ?? (() => Date.now());
  /* `opt` 在上面随模式展开一起解析了（`expandMode` 要在 standalone 分派之前生效），
   * 这里不再第二次 parse —— 两份解析会在「运行期环境变了」之类的场景分叉。 */
  const codes = /** @type {number[]} */ ([]);
  const want = (/** @type {string} */ p) => !opt.only || opt.only === p;
  /** 下面几段共用的远端/基线，在两道守卫之后解析（见 `resolveUpstream` 那一段的注释）。 */
  /** @type {{remote: string | null, base: string | null, source: string}} */
  let up;
  /** @type {string | null} */
  let baseRef;
  /** @type {string | null} */
  let baseBranch;
  /**
   * 把一个外部命令的输出**原样**转述出来 —— **含 stderr**。
   * 钩子与 git 都把关键的话写在 stderr，只转 stdout 等于把理由丢掉、
   * 只留一句「失败了」。本工具存在的理由就是别干这事。
   *
   * @param {{stdout:string,stderr?:string}} r 执行结果
   */
  const relay = (r) => {
    if (r.stdout?.trim()) {
      log(r.stdout.trimEnd());
    }
    if (r.stderr?.trim()) {
      log(r.stderr.trimEnd());
    }
  };

  /* 旗标组合的合法性判在 `ship-args.mjs`（与 `parseArgs` 同一层 —— 那一层跟着「命令行
   * 长什么样」动；ISSUE #3619 现场把本文件顶过 900 行硬闸，按「声明层与机制层分开」
   * 迁出）。命中 ⇒ 逐行打出后停，一条 git / cnb 命令都不发。 */
  const flagErrors = flagConflicts(opt);
  if (flagErrors.length > 0) {
    for (const line of flagErrors) {
      log(line);
    }
    return CODE.NOT_RUN;
  }
  /** `--mode confirm`：合并 / 关单 / 删分支每步先问一次。确认应答器**恒定义**
   *  （造一个闭包不开 stdin，调用才读流），非 confirm 模式的三个调用点都在
   *  `modeConfirm` 分支里、一次也不会被走到 —— 这样 tsc 不需要跨 const 收窄，
   *  也不引入断言（#3167 对断言收窄零容忍）。可注入（`deps.confirm`，测试喂
   *  PassThrough）；缺省 = 读真实 stdin，fail-closed。 */
  const modeConfirm = opt.mode === "confirm";
  const confirmStep = deps.confirm ?? makeStdinConfirm();
  /** confirm 模式下被拒的动作（读数，不改退码；收尾结论行前汇总一遍）。 */
  const confirmSkipped = /** @type {string[]} */ ([]);

  /* ── 远端名与主干基线：在两道守卫（未知旗标 / `--only` 单独跑）之后解析一次 ──
   * push / PR 正文 / fetch / 「回读主干顶端」四段都要用它，所以不能等各段各自去推。
   *
   * ⚠️ 「上游 `@{u}`」与「主干基线」**不是同一件事**，这一格错过一次：
   * `git push -u origin feat/x` 把这条分支的上游设成**它在远端的副本**
   * （`origin/feat/x`），于是拿 `@{u}` 当基线就是 `feat/x...HEAD` —— 自己与自己比，
   * 结果恒空，碎片那一查报「0 份 ⇒ 单 PR 单变更不成立」。而撞上它的正是
   * **推送之后的那一次跑**，也就是 `pnpm ship --merge` 那一跳（实测在
   * `pnpm ship --no-wait` 上：exit 1「没有 changelog.d/ 碎片」）。
   * 所以远端名先落地，再取 `refs/remotes/<远端>/HEAD` 那条**本地就有**的符号引用
   * （零网络）当主干；两处都取不到时才退 `<远端>/master` 并标明是推的。
   *
   * 远端名同样是每台克隆自己的事实，不写死（并行检出里见过 `cnb`，本检出实测只有
   * `origin`；见 docs/audits/2026-10-12 R12-01）。推不出远端名时**不在这里**判红：
   * 各阶段拿 `up.remote === null` 自己退 NOT_RUN —— 「取不到远端」与
   * 「这一步跑出来是红的」是两件事（三态退出码那条口径）。 */
  const upRes = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const remotesRes = run("git", ["remote"]);
  const headRes = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const localBranch = headRes.stdout.trim();
  /* 第一趟只要「远端叫什么」—— 主干那条符号引用是按远端名去问的，得先知道远端名。 */
  const probe = resolveUpstream({
    upstream: upRes.stdout,
    remotes: remotesRes.stdout.split("\n"),
    localBranch,
  });
  up = resolveUpstream({
    upstream: upRes.stdout,
    remotes: remotesRes.stdout.split("\n"),
    localBranch,
    remoteHead: probe.remote
      ? run("git", ["symbolic-ref", "--quiet", `refs/remotes/${probe.remote}/HEAD`]).stdout
      : null,
  });
  /* 基线引用要**真的存在**才拿来比：拿不存在的 ref 做 `A...HEAD`，git 失败、stdout 为空，
   * 而这一查的语义是「这条分支带进来了什么」—— 空串会被读成「什么都没带」，
   * 一条听起来完全正当的假结论。所以正面验一次，验不到就往下标成「没有事实源」。 */
  baseRef =
    up.base !== null && run("git", ["rev-parse", "--verify", "--quiet", up.base]).status === 0
      ? up.base
      : null;
  /** 主干**分支名**（PR 的 `--base` 要的是它，不是 `<远端>/<分支>`）。推不出就不给
   *  `master` 兜底 —— 兜一个猜的分支名，报出来的是「PR 建到了不存在的主干上」。 */
  baseBranch = baseRef ? baseRef.split("/").slice(1).join("/") : null;

  /** 仓库 slug 与 cnb 在场性 —— 装配层的事实（阶段 0 的屏幕输出与「只补关」那一路都要用）。 */
  const slugRes = up.remote ? run("git", ["remote", "get-url", up.remote]) : { stdout: "" };
  let slug = parseSlug(slugRes.stdout);
  /* 留痕短名在**所有**要它的格子之前取一次：whoami、领取 / 结束 / 列表、preflight 的
   * 单子身份读数、PR 标签、关单后的结束评论。各格自己再读一次会让同一次跑里出现两套答案
   * （进程环境与 `.env` 在两次读之间变过就会分叉）。 */
  const who = readDevHandleWithSource({ root, env });
  /* 这台机器上「有没有人**真的**填过」是另一件事：取值链保证给得出名字，但
   * 「单子会建、标签打不上」那一档的判据（`ship-issue-new.mjs` 的回读）必须能分辨
   * 「你填了却没落地」与「这名字是取的、本来就不会有标签」。只看 `COMFYAPP_DEV_HANDLE`。 */
  const explicitHandle = handleFromProcessEnv({ root, env });
  const handle = who.name;
  /* ── 与主流程互斥的单件动作（`--whoami` / `--diagnose` / `--rerun-ci` /
   * `--branches` / 单子那几格 / 只补关）—— 分派与各自的互斥守卫都收在
   * `ship-standalone.mjs`，这里只决定「这一跳还要不要往下走」以及把**这一次** probe 的
   * cnb 在场性带出去（后面每段都要它，别 probe 第二遍）。 */
  const standalone = await runStandaloneAction({
    opt,
    run,
    log,
    relay,
    probeCnb,
    slug,
    up,
    localBranch,
    root,
    handle,
    whoSource: who.source,
    explicitHandle,
    mkTmp,
    settle: (cs) => finish(cs),
    env,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    sleep,
  });
  if (standalone.handled) {
    return standalone.code;
  }
  const cnbOk = standalone.cnbOk;

  // ── 阶段 0：preflight（实现见 `ship-preflight.mjs`）──────────────
  if (want("preflight")) {
    const pf = await runPreflightStage({
      run,
      log,
      relay,
      opt,
      root,
      up,
      baseRef,
      baseBranch,
      slug,
      cnbOk,
      handle,
      handleSource: who.source,
      explicitHandle,
      readInstances: deps.readInstances ?? readAppInstances,
    });
    codes.push(...pf.codes);
    if (pf.action === "stop") {
      return pf.code;
    }
    if (pf.action === "finish") {
      return finish(codes);
    }
    if (pf.action === "dry-run") {
      return CODE.GREEN;
    }
    /* slug 由 preflight 的 `!slug` 闸收窄后带回：阶段 0 之后的平台动作不再面对 null。 */
    const { branch, frags, staged, unstagedModified, untracked, sha } = pf;
    slug = pf.slug;
    /* 「走到哪了」第一格（ISSUE #3083）：阶段名 + 关键身份。进度与退码是两套信息 ——
     * 这一行说「预检走完了」，结论那行才说「结果是什么」。 */
    reportStage(log, "预检通过", {
      branch,
      sha: short(sha),
      repo: slug,
      碎片: `${frags.length} 份`,
    });

    // ── 阶段 1：commit（实现见 `ship-local.mjs`，判据仍在 `ship-core.mjs`）──
    if (want("commit")) {
      const r = runCommitStage({
        opt,
        root,
        staged,
        unstagedModified,
        untracked,
        log,
        run,
        relay,
      });
      codes.push(...r.codes);
      if (r.stop) {
        return finish(codes);
      }
    }

    // ── 阶段 2：push（合并前固定动作由 pre-push 钩子自己跑）────
    if (want("push")) {
      const r = runPushStage({
        up,
        branch,
        root,
        resolveDir,
        log,
        run,
        relay,
      });
      codes.push(...r.codes);
      if (r.stop) {
        return finish(codes);
      }
    }

    // ── 阶段 3-6：平台侧（需要 cnb，实现见 `ship-platform.mjs`）──
    if (!cnbOk) {
      codes.push(CODE.NOT_RUN);
      return finish(codes);
    }
    /* 跑期内切分支即漂移（ISSUE #2812）：阶段 0 抬头记的是那时的分支，而平台段（PR 的
     * `--head`、轮询归属的 sha）若按**现读**的 HEAD 取数，外部一次 `git checkout` 就会让
     * 「抬头记的分支」与「轮询读的 sha」在同一次跑里互相矛盾，且轮询会为另一条分支的
     * sha 空等。所以在进入平台段之前复核一次：分支被换 ⇒ 停（2），不拿不自洽的读数往下走。
     * commit 段正常加笔不算漂移 —— 分支名不变，只有 sha 前进，而 sha 正是在这里钉住一次、
     * 供 PR / 轮询 / 判决全程复用的。 */
    const branchNow = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (branchNow !== branch) {
      log(
        `[ship] 跑期内分支被切换（${branch} → ${branchNow || "(取不到)"}）⇒ 停（${codeTag(
          CODE.GUARD_REFUSED,
        )}）：` +
          "本轮前面的读数记的是旧分支，而平台动作会落到新分支上，两者已经不自洽。" +
          "回到原来的分支重跑（PR 已存在会复用，不重建）。",
      );
      codes.push(CODE.GUARD_REFUSED);
      return finish(codes);
    }
    const newSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();

    if (want("pull-request")) {
      /* `--pr-body-file` 是**输入端**：只读一处，读完把原文交给平台段（建 PR 与复用
       * 更新都吃同一份）。读不到 / 空文件在这里停（2）—— 给了旗标却发一份空正文，
       * 在屏幕上与「不给旗标」分不开，而这两件的本意正相反。
       * 原文里的 `Closes` 只提示、不改写：关单是统一动作（合并后 `--close-issue`），
       * 但删不删是人的判断，脚本不替他改正文。 */
      let prBody = null;
      if (opt.prBodyFile) {
        const bodyPath = path.resolve(root, opt.prBodyFile);
        try {
          prBody = fs.readFileSync(bodyPath, "utf8");
        } catch {
          log(
            `[ship] --pr-body-file 读不到（${bodyPath}）⇒ 正文没有落点，PR 不建也不更新（${codeTag(
              CODE.NOT_RUN,
            )}）。`,
          );
          codes.push(CODE.NOT_RUN);
          return finish(codes);
        }
        if (!prBody.trim()) {
          log(
            `[ship] --pr-body-file 给的是空文件（${bodyPath}）⇒ 不把「空」当成「没给」：` +
              `这一格按用法错停下（${codeTag(CODE.NOT_RUN)}）。`,
          );
          codes.push(CODE.NOT_RUN);
          return finish(codes);
        }
        if (mentionsCloses(prBody)) {
          log(
            "[ship] --pr-body-file 的正文里有 `Closes`：本项目的关单是统一动作" +
              "（合并验真之后由 `--close-issue` 收），单条 PR 不自己关单 —— 已按原文注入、不改写。",
          );
        }
      }
      const { number, stop } = createOrReusePull({
        run,
        log,
        mkTmp,
        root,
        slug,
        branch,
        frags,
        baseRef,
        baseBranch,
        explicitTitle: opt.title,
        handle,
        prBody,
      });
      /* ISSUE #3083：收口码由那一格给（冲突 ⇒ 3 / 已落地守卫 ⇒ 6 / 建不出来 ⇒ 2），
       * 出口话术在那一格已经念过；冲突的 PR 平台不会派生 CI，往下走（轮询最长
       * 45 分钟预算）只是把同一句「没有结论」推迟。 */
      if (stop !== null) {
        codes.push(stop);
        return finish(codes);
      }
      if (!number) {
        codes.push(CODE.NOT_RUN);
        return finish(codes);
      }
      codes.push(CODE.GREEN);

      // ── 阶段 4：poll ─────────────────────────────────────────
      if (!(want("poll") && opt.wait)) {
        log("[ship] 跳过轮询（--no-wait / --only）⇒ 不合并。");
        codes.push(CODE.GREEN);
        return finish(codes);
      }
      /* 轮询是这条链上最长的等待（ISSUE #3144）：段内读数由 `pollUntilTerminal`
       * 自己打，这条线补的是「它已经等了多久」—— 一段 20 秒没动静时读得出。 */
      const pollProgress = startProgress({ label: "CI 轮询", intervalMs: 20_000 });
      let poll;
      try {
        poll = await pollUntilTerminal({
          run,
          log,
          slug,
          newSha,
          now,
          sleep,
          number,
          baseRef,
        });
      } finally {
        pollProgress.done();
      }
      if (poll.stop !== null) {
        codes.push(poll.stop);
        return finish(codes);
      }
      const { buildState, buildSn } = poll;

      // ── 阶段 5：verdict ──────────────────────────────────────
      if (want("verdict")) {
        codes.push(reportVerdict({ run, log, slug, number, buildState, buildSn, baseRef }));
        /* 判红 ⇒ 自动回读一次 GA 失败日志（规范 §13.6）：台面上直接给出 run / job /
         * step / 注解 / 窗口 / 一行归因；没有令牌只念一行，不改三态（`runGhLogsOnRed`
         * 的返回值刻意不进 `codes` —— 日志取不到不等于判红）。 */
        await runGhLogsOnRed({
          buildState,
          number,
          repo: slug,
          /* CNB 侧优先读 relay 正文（ISSUE #3437）：判红时本地从站内取日志，
           * 不必出站 github.com。`run` / `slug` 与主流程同一份执行者与坐标。 */
          cnbIo: slug ? { run, slug } : undefined,
          env,
          log,
          fetchImpl: deps.fetchImpl ?? globalThis.fetch,
          sleep,
          dryRun: opt.dryRun,
        });
      }

      // ── 阶段 6-8：终局三跳（合并 / 关单 / 删分支）—— 模式下的装配 ──
      /* 实现收在 `ship-mode.mjs` 的 `runFinalStages`（#3512）：问不问 / 跳不跳 /
       * 念什么出口是「模式怎么改变阶段 6–8 的走法」，与装配层的变化方向不同；
       * 判定本身仍在 `ship-platform` / `ship-close`。`landed` 由合并那一跳在
       * **验真之后**就地填（阶段 7 要从它的标题本体取号，那里不回推 —— 合并会把
       * HEAD 挪走，`pickTitle` 那时算不出这条分支的第一笔）；`confirmSkipped`
       * 是同一个数组的引用，`finish()` 在结论行之前汇总它。 */
      const landed = { title: "", sha: "", verified: false };
      const fin = await runFinalStages({
        run,
        log,
        want,
        opt,
        modeConfirm,
        confirmStep,
        confirmSkipped,
        slug,
        number,
        frags,
        baseRef,
        up,
        buildState,
        branch,
        landed,
        handle,
        handleExplicit: who.explicit,
        mkTmp,
      });
      codes.push(...fin.codes);
    }
  }

  return finish(codes);

  /**
   * @param {number[]} cs 各段结论
   * @returns {number} 合并后的退出码
   */
  function finish(cs) {
    /* 一条结论都没有 ≠ 「都跑了且是绿的」。这一格错过一次：`--only=commit` /
     * `--only=push` / `--only=pull-request` 会把阶段 0 整段跳过（后面每一段都嵌在
     * `want("preflight")` 里面），于是 `cs` 是空数组，而 `combineShipCodes([])`
     * 回 `0` —— 屏幕上落出「全绿到终态」，实际**一段都没跑**。三态口径里那第三条
     * 「没跑起来 ⇒ 2」本来就是给这种形状准备的，只是空数组此前没人接。
     * 空账这一格按 `NOT_RUN` 而不是按「请求过的阶段列表」判：将来再加段、或有人
     * 把某段改成条件跳过，都掉不进同一个假绿灯。 */
    if (cs.length === 0) {
      log(
        `[ship] 本次没有任何一段落下结论${opt.only ? `（--only=${opt.only} 用不上：阶段 0 之外的每一段都排在它后面）` : ""}` +
          " ⇒ 记「没跑起来」（exit 2），**不是**「通过」。",
      );
      return CODE.NOT_RUN;
    }
    const code = combineShipCodes(cs);
    const word =
      code === CODE.GREEN
        ? "全绿到终态"
        : code === CODE.RED
          ? "有事实是红的"
          : "有一步没跑起来（**不等于**通过）";
    /* 确认模式的跳过必须在结论行**之前**汇总（结论行之后再补一行，就成了
     * 「一句声明被自己的下一行修正」的形状）。跳过不是失败 —— 但也不许长得像执行过。 */
    if (confirmSkipped.length > 0) {
      log(
        `[ship] 确认模式：${confirmSkipped.length} 个动作未授权被跳过（${confirmSkipped.join("、")}）` +
          " —— 各自的手动出口在上面，**跳过不是执行过**。",
      );
    }
    log(`[ship] 结论：exit ${code} —— ${word}`);
    return code;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  /* CLI 是唯一把真实落点交进来的入口；编排层被 import 调用时默认不落盘。 */
  main({ shipResultResolve: resolveGitDir }).then((code) => process.exit(code));
}
