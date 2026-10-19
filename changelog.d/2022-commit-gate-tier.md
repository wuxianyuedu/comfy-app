## Changed

- **本地 pre-commit 降成「形态档」，重档的家搬到平台**（ISSUE #2022，口径见新增 §13.5.25）：
  业主口径是「pre-commit 超过 5 分钟人们就不跑了」，而「门槛拦得住」是 §13.6 整节的前提。
  §13.5.24 那三刀把组 C 从 110 份压到 88~89 份之后仍然超——本机账本 33 次提交：钩子总墙钟
  中位 **346.6s**、p90 **894.9s**，各组中位 A(tsc) 17.6s / B(eslint) 109.0s /
  C(受影响用例) 362.7s / D(静态判据) 126.0s / D0(形态前置) 21.2s。注意墙钟取 `max(各组)`
  而不是求和（各组中位之和是 636.5s 那个数，把它当总耗时没有任何人能复算），所以尾巴是
  **组 C 那一档的形状**，不是「哪几份用例还贵」——继续砍清单已经没有意义。
  于是刀口从「跑哪些」换成「在哪跑」：本地默认只跑组 0 + D0（实测一次 **28.3s**），
  `tsc` / `eslint` / 全量单测 / 其余静态判据由平台跑，**「PR 跑绿才合并」由此成为纪律而不是习惯**。

- **搬的形式是「档位开关」，不是「把步骤删过去」**——这条不是风格问题，是机械可查的：
  `scripts/check-gate-executors.cjs` 认的执行者出处只有钩子的 `run "<标签>" <命令>` 行、
  `quality-gate.mjs` 的 gate 表、`quality-gate.ps1` 的 `$Blocks` 三处，**`.cnb.yml` 不在它的
  解析面上**。把步骤删到 CI 里 = 那一族判据当场失去执行者，而账面一条红都不会出现。所以
  `.githooks/pre-commit` 里那批步骤逐字留在原处（连缩进都不动），只有 `run_group()` 按
  `COMFY_HEAVY_GATES` 决定启不启；CI 那一格 `重档静态判据`（`scripts/ci-heavy-gates.mjs`）
  读的是**同一份注册表**，只剥掉 `--staged`（CI 没有暂存区，留着它就是判「空提交」= 一条恒绿）。
  本地全套出口：`COMFY_HEAVY_GATES=1 git commit` / `pnpm check:all`。

- **跳过与接手都必须被说出来**：钩子收尾打印「本地**没跑**：组 A B C D」并紧跟「这句不是
  『已通过』，它等价于这次没测行为面」；而**重档并没有消失，它搬到了推送那一跳** ——
  `.githooks/pre-push` → `pnpm check:premerge` 默认跑各段全套：`base` 段在合并快照上复算整张
  注册表，新增的 `unitTests` 段在**本检出**上跑受影响用例（清单 =
  `merge-base(要并进去的那条, HEAD)..HEAD`，经新通道 `COMFY_AFFECTED_CHANGED` 交给
  `run-affected-tests.mjs` 的**同一条判决链**——不在 premerge 里再筛一遍，两处各筛一次的漂移是
  静默的）。取不到清单时那一段**退 2**，不是退 0：没判 ≠ 判过且绿。想只推形态档那几条用
  `--light`，它会打印跳过了几条重档；两处「本地档是哪几条」共用 `localTierLabels()` 从钩子文本
  的 `run_group D0` 块边界取，不另立第二份名单。`ci-heavy-gates.mjs` 的退出码与 `base-check` /
  `premerge` 逐字同口径：`0` 全绿 / `1` 有档红 / `2` **有档没跑起来**（把 127 并进「红」就等于
  宣布判据判出失败，而事实是它没判）。

- **`docs/api/**` 不再要求本地跑 `pnpm run docs`**：平台那一格本来就是 `AUTOFIX_DUTIES` 登记过的
  写者，**先就地重生成、再判**（`verifyDeterminism` 复核过「同源两次产出逐字节相同」），所以
  「改完 `src/lib` 顺手 typedoc 一遍」对任何一次代码回归都不承重，只把两千多份生成物糊进
  工作区与暂存面。AGENTS 里那句「报落后/缺失/多余时 `pnpm run docs` 重生成并一并提交」改为
  「交给平台」；本地真要跑只剩两种情形：发版/整理那一轮，或人明确要求。
  `pnpm doc:render` / `pnpm doc:check` 照旧（便宜，且判的是本仓自己维护的文字）。

- **恢复一格、新增一格，另一格试了又退回**（`.cnb.yml`）：`ESLint 零警告` 从注释态回来（当初让它
  是「本地 B 组每条提交都在跑同一条 lint，这里再跑没有新信息」，那条前提随钩子降档**反转**——
  本地不跑了，它从重复变成唯一执行者），新增 `重档静态判据` 承接那批静态判据。
  `单元测试` 这一批**先取消注释、再退回停用**，理由值得留在配置里：它当初停在「宿主侧够不着
  Python」（这条已不成立），恢复之后撞上的是并行会话那条**仍然有效**的决定——会自己起一堆
  子进程的那两档只在每天 04:00 那一跑（§13.5.21）：同一台机上**并行 PR** 会把带超时的读数变成
  不可信的红，而 `full-suite-run.mjs` 跑绿还要刷「整档凭证」，拿并发下的绿去刷那张账比不刷更坏。
  ⇒ 单测在 PR 这一跳的执行者是**本地 pre-push 的 `unitTests` 段**（跑受影响面、单机自己承担
  负载、不刷整档凭证），节点上仍是 `每日单元测试`；恢复那一格的条件是「平台能给它一条不与
  并行 PR 争抢的执行环境」——那是这条决定的边界，不是判据。
  在场与退回的三格都带 `scripts/ci-cp936-exit.mjs` 那层包裹（「真红时日志读不出原因」是当初
  退回 ESLint 的另一半理由）。本地同一条命令实测：静态判据全量档串行**全绿、零条「没跑起来」**
  （逐条读数在 `[重档] 合计` 那行输出里，条数不写进文档——钩子每加一步那个数就静默过期，
  ISSUE #1407）。

- **顺带拆了一刀 R5**（§12.6）：`premerge` 那一段要的 `COMFY_AFFECTED_CHANGED` 通道把
  `scripts/run-affected-tests.mjs` 推过 900 行硬闸（911 行），而判据给的唯一出口是拆。
  「认出超时形态 + 等机器喘口气」那一层（指纹清单、每核负载读数、有界等待、共享预算余量）
  搬进 `scripts/affected-launch-load-retry.mjs` —— 按**职责**切、不按行数剪：这一层既不依赖
  清单也不依赖 vitest 入口。同族先例是 `affected-launch-retry-scope.mjs`（复跑面）与
  `affected-launch-rerun-report.mjs`（话术层）。搬的过程当场抓到两件事，都不是能糊过去的：
  ① 那块代码原本躲在主文件的 `@ts-nocheck` 底下，而两份同族模块拆出去时都是**带类型**的 ⇒
  按约定补类型（`probe?: object` 在两个调用点上不可赋值、async 的 `@returns` 得写成
  `Promise<T>`），不是给新模块续那条豁免；② `tests/hook-affected-launch.test.ts` 里「两份超时
  指纹清单不许漂」那条按**路径**读原文，清单搬走后它读老地方会落空 —— 因为它自带
  `mine.length > 0` 的前置断言，表现是当场红而不是静默空转（那条断言当初就是为这个写的），
  改读新模块即可，**别为了它把清单抄回两处**。

**判据**：`tests/commit-gate-tier.test.ts` —— 注册表总数与本地档边界的形状（条数只写在断言里）、
标签零漂移、档位哨兵/跳过标记/收尾点名三者同时在场、四组 `run_group` 仍在场、
premerge 四段里 `unitTests` 在场且**拿不到清单退 2**、`COMFY_AFFECTED_CHANGED` **两向**验证
（只判正向的话，env 被读了个名字而判决链照旧读暂存区也照样过）、premerge 与 CI 读同一份注册表、
`--staged` 只剥这一个旗标、注册表读不到时退 2 而不是退 0。
同批核过：`tests/no-platform-ci-config.test.ts` + `tests/gate-executors.test.ts` +
`tests/doc-check-hook-wiring.test.ts` + `tests/precommit-timing.test.ts`（170 例）、
`scripts/ci-incremental-gates.mjs --check`。
