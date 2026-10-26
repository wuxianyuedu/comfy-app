## Added

**`pnpm ship --branches`：删分支之前那句「它落地了没有」终于有一个不靠猜的入口**（ISSUE #2427，规范 §13.6.5）。

- 为什么要有：本仓 PR 走 squash，`git branch -d` 的祖先判据恒假 ⇒ 真删只能 `-D`，而 `-D` 不看任何事实。
  「先判断合了没」这一步**没有入口**，于是每个人自己挑一个命令当判据 —— 实测挑错的代价不对称。
- **三个看着像判据、其实不是的东西**（表格在 §13.6.5）：`git diff origin/master...<分支>` 三点 diff
  答的是「这条分支自己改了什么」，起点是 merge-base，与主干无关 ⇒ **永远非空**
  （实测九条**全部已合并**的分支逐条都显示「有独有差异」，而我第一轮就拿它当过筛选器）；
  `git branch -d` 同原因恒假；提交信息里的 `(#N)` 是人写的字。
  **唯一依据是 PR 的 `is_merged`**（`--state` 没有 `merged` 这一档，`closed` 里混着两种结局）。
- 入口的形状（`scripts/ship-branches.mjs`）：逐条本地分支给 `PR 号 / is_merged / merged_by /
  远端引用在不在 / tip sha` 五件原值；结论只有 `landed` / `not-merged` / `no-pull-in-window` 三种，
  其中第三种是「**没取到**」—— 与「没合并」必须长得不一样（§13.6.4），有它整跑退 2 不念绿；
  末尾自证取数覆盖面（翻几页 / 多少条 / 最老到第几号 / 窗口取没取满），因为 `list-pulls`
  不能按 head 过滤，只取一页就去判等于拿「我没取到」冒充「它不存在」。
- **只读**：一次也不写 ref。与任何显式动作（`--merge` / `--clean-branch` / `--add` / `--claim` …）
  同行 ⇒ 退 2 且一次平台请求都不发 —— 红线 ①「显式动作不许被推断」的反面：**读数也不许被读成动作**。
- 两处形状坑（都是拿这条读数**自己跑一遍**才抓到的，见 §12.20 那条同名纪律）：平台给的是
  `head.ref = "refs/heads/<分支名>"`（按裸名匹配 ⇒ 全条落空，那份空读数和「这些分支没提过 PR」
  逐字同形）；`resolveTrunk()` 给的基线带远端前缀（`origin/master`），与 `for-each-ref` 的裸名
  不同形 ⇒ 排除主干要先剥一层（只剥一层，分支名自己可以带斜杠）。
- 同批：`ship-core.mjs` 抽出 `pullRecordForBranch`（`findPullForBranch` 改为复用它，
  `refs/heads/` 那个形状仍只有一处）；Skill 的用法表与「删之前那一问」各加一行；
  `AGENTS.md` 只在定位表上加了 §13.6.5 的指针（不抄旗标清单）。
  判据：`tests/ship-branches.test.ts`（三种结论、裸名不匹配、窗口截断只影响取不到的那些、
  与 `--merge` 同行不退到主流程，并反向钉住「`branch -D` / `git push` / `merge-pull` 一条都不许出现」）。
