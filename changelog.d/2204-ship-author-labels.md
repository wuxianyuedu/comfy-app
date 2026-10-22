## Fixed

- **`ship` 建的 PR 没有作者标签、正文没有署名 —— PR 与 issue 评论现在带同一份留痕（ISSUE #2204）**：
  issue 侧 #2175 已落「提单人」读数，而 PR 这一侧一处都没有 —— 多份并行检出共用一个
  cnb 账号时，PR 列表分不出是谁的（与 #2175 之前的 issue 列表同形）。当场读数：
  `cnb pulls post-pull --help` **没有** `--labels`（与 `create-issue` 同形）；PR #2202
  上手工跑 `post-pull-labels` 后 `list-pull-labels` 回读是 `["dev:yuedu-win"]`（是真的），
  而 `ship` 建出来的 #2202 回读是**空** —— 那个标签是手打的，不是 `ship` 打的。
  现在：
  ① **一处实现** —— `dev:<短名>` 与署名行只由 `ship-ticket.mjs` 的 `devLabel()` /
  `signatureLine()` 生成（`issueAuthoring`、PR 正文、`--whoami` 共用；不造第三份取短名逻辑）；
  ② **建 / 复用 PR 后补标签并独立回读** —— `post-pull-labels` 之后必须再问一次
  `list-pull-labels`，回读里看得见那个名字才念「已打上」（回执不算结论，与合并、关单同一条）；
  ③ **PR 正文末尾一行** `提交人：dev:<短名>`，未配时如实写 `提交人：未配`、不编；
  ④ **手工通道的漏口给一条能粘贴的出口** —— `pnpm ship --whoami` 打出这份检出的短名、
  署名行与 `post-pull-labels` / `list-pull-labels` 两条命令，一次也不碰平台、不改状态。
  三条边界：**未配 handle 不阻断**（留痕是读数，不是判据；Windows 检出点名给出**这一份**
  `.env` 的绝对路径与 `pnpm env:init`）；**不拿 git `user.name` 顶替**（提交身份 ≠ 提单身份）；
  **不写成「账号自动带上」**（平台 `author` 是 token 的账号本体，跨检出逐字相同）。
  回归见 `tests/ship.test.ts`：`devLabel / signatureLine / whoamiLines` 三条纯函数组、
  `buildPullBody` 的署名两向、`planCommands` 的标签 ⇄ 回读成对，以及 `main()` 里
  「打标签 → 回读的顺序 / 回读没有时的负控制 / 未配时一次标签动作都不伸手 / 复用 PR 也补 /
  `--whoami` 不碰 cnb」五格。规范 §13.10.10 与 `ship` Skill 同步。
