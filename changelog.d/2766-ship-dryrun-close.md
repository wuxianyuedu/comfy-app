## Fixed

- **`pnpm ship --close-issue <号> --dry-run` 不再真的把单子关掉（ISSUE #2766）**：
  装配层那一次调用**少传了一个字段** —— `scripts/ship-standalone.mjs` 的「只补关」分支
  （`opt.closeIssue && !opt.merge`）调 `closeIssues({...})` 时没带 `dryRun`，而同一个文件里
  `--diagnose` / `--stage-log` / `--claim` / `--release` / `--new-issue` 三条以上都带了
  `dryRun: opt.dryRun`。后果是「预览就是预览」那句声明（`scripts/ship.mjs` 用法行与
  project Skill 第 24 条）**在关单这一格是假的**：三件写动作一件不落 ——
  置 `closed/completed`、发「开发结束」评论、撤 `处理人:` 标签。
  现场读数在单子里：跑前 `--claims` 列三张，跑后只剩一张，`closed_at` 落在那次 `--dry-run`
  之后 45 秒内。

  - 取的是单子里**第 1 案**（`closeIssues` 接受并转发 `dryRun`），不在分派处一拦了之：
    拦在那一层会让人看不见凭据。现在**读面照跑** —— 落地证明仍从平台回读 `is_merged`、
    该不该关仍由 `decideCloseIssue` 判、「不关的那几张」仍逐张说明为什么没结论，
    预览与真跑念到的是**同一份判决**；只从第一件写动作起一条也不发，并把要写什么念出来
    （那三件：置态 / 评论 / 撤标签，评论与撤标签按处理人标签决定）。
  - 退码是 **0 而不是 2**：这一格**跑起来了**，它的结论是「按这些凭据可以关，而这次没写」。
    落成 2 会把「预览成功」混进「没跑起来」那一档，而 2 在本仓压过 1，读的人要去查它凭什么红。

  判据打在**装配层 `main()`** 上而不是只打在 `closeIssues` 上（`tests/ship.test.ts` 新增一组两条），
  因为这次的回归形就是「调用点漏传」—— 只测被调方那一层，这一格永远不会红。
  两条是一对：`--dry-run` 那条断言四件写动作（`update-issue` / `post-issue-comment` /
  `post-issue-labels` / `delete-issue-label`）**一条都没进 `run`**、而 `get-pull` 照被读、
  屏幕上出现「将置 state=closed」与「一条写命令都没发」；对照那条不带 `--dry-run`，
  断言 `update-issue` **确实发了一次**且带 `--state closed --state-reason completed`
  —— 缺了对照，「整条链根本没跑起来」也能把前一条读成绿。

  同一批把单子里点名要顺手看的那格量完（**真机跑，不是读代码**）：
  `--claim 2766 --dry-run` ⇒ 评论数 1 → 1；`--release 2766 --dry-run` ⇒ 标签逐字不变；
  `--new-issue … --dry-run` ⇒ `list-issues --keyword` 回读 0 条。
  这四格里只有「只补关」那一格原本是漏的，其余三条本来就认 `--dry-run`。
