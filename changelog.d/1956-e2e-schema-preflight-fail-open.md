## Fixed

- **e2e 的 schema 预检把「探测没拿到语句清单」读成「库本来就对」**
  （`scripts/e2e-schema-preflight.mjs`，本轮从 `scripts/e2e-run.mjs` 拆出）。

  `schemaPreflightDecision` 的第三条分支只看 `pending.length === 0` 就放行，理由是
  「指纹只是没登记」。但空清单有**两种成因**，而它把两种压成了一种：

  1. drizzle 走到了终态、说 `No changes detected` —— 库本来就对，放行是对的；
  2. 它在**列出语句之前**就要人回答一个问题 —— 那句 `about to execute` 根本不出现，
     清单自然是空的。这不是「没问题」，是**没拿到测量**。

  实测复现（在临时目录的一份快照副本上真跑，仓库与活库未碰）：把库里那张
  `workflowTemplate` 改名走，diff 撞上 `promptNamedWithSchemasConflict`
  （「这是改名还是新建+删除」），无 TTY 时当场抛：

  ```
  blockedByTty = true   pushConverged = false   pendingStatements.length = 0
  现行判决 = {"verdict":"proceed","reason":"指纹不一致但 dry-run 没有待执行语句（指纹只是没登记，库本来就对）"}
  ```

  即：**这张库明明少一张表，预检答「库本来就对」并放行。** 而这一卡存在的理由
  （#1834）正是那批「库落后几个版本 → `task` 缺列 → `queue-status` 500 →
  queue-monitor 四条 + main-journey 两条稳定红，报错话术全在说「元素没出现」」。
  同一条链上 `pushBlockedByTty` 这个判词早已在 `ensureSchemaCurrent` 那侧使用，
  只是没被当成这一层的输入。

  修法是把判决改成三值并让新增那一档**落在阻断侧**：调用方交出
  `measured = 列出了语句 || 输出走到 No changes detected`，其余形态（交互被挡在枚举
  之前 / 命令没起来 / `Changes applied` 却读不出清单 / 输出认不出）一律「没拿到」⇒
  阻断。口径同 §13.6.2「拿不到测量 ≠ 测量结果是红的」，反过来也不成立。
  `measured` **没有缺省值**：不写就走阻断那一支，忘了传也不会把没读到的念成绿。
  阻断话术里「这是要人做『丢不丢得起』决定的变更」那半句改成只在真拿到清单时才说 ——
  给没测到的东西编一个诊断，与放行那一档是同一个错的两半。

- **`pnpm db:push` 不解析 argv，未知旗标被静默吞掉之后照样写库**（`scripts/db-push.mjs`）。

  这个入口此前一句 `argv` 都不读，所以任何参数都被当成「没有参数的那次调用」，
  而它默认动的是 `pushSchema(root, { force: true })` —— 真写库，且 `--force` 的语义
  就是「自动批准会丢数据的语句」。本轮就是踩了这一格：本想拿一份不写库的语句清单，
  敲了 `node scripts/db-push.mjs --dry-run`，它照旧起了 `drizzle-kit push --force`
  并把批次落了库（那批里唯一一条 `DROP TABLE loraTrainingJob` 恰好打在一张 0 行的表上，
  没造成损失 —— 但**这个方向本来不该由「恰好那张表是空的」来兜**）。

  修法不是补一个 `--dry-run` 实现，而是**破坏性入口拒绝未知参数**：认不出就非零退出、
  说明它默认动的是什么，并把「要一份不写库的清单」指到那条已被本轮实测过的出口
  （`pnpm exec drizzle-kit push`，不带 `--force`；无 TTY 时它列完语句停在确认那一步）。
  配套用例判的是**库没被建出来**，不是话术 —— 「打印了拒绝的话」与「没动库」是两件事。

  同族的 `scripts/db-migrate.mjs` 也是「不读 argv」的形状（它同样一句参数都不解析），
  本轮**未**一并改 —— 不借这一单扩面，留给单独一单。
