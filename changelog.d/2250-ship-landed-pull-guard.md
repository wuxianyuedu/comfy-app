## Fixed

- **ship：内容已随 squash 落地之后，再对同一条分支跑会多建一条幽灵 PR**（ISSUE #2250）。
  幂等那一格只查 `list-pulls --state open`，而合并成功会把 PR 转 `closed` ⇒ 从那一刻起
  「找不到就建」长出来的是**内容已在主干**的 PR：它能被再 squash 一次（主干多一笔重复提交），
  还白烧一轮 CI。现在建 PR 之前按 `head.sha` 逐条认 `is_merged`（与 `ship-close.mjs` 的落地反查
  同一套取法，不另写判定），命中即停并念「已随 PR #N 落地 ⇒ 要接着改请开新分支」，按 `2` 收，
  不给 `--force-pull` 那类绕过口。读不到 closed 清单时**不撤销结论**、照旧建 PR ——
  「取不到」不等于「没落地」，把缺读数判成已落地会多出一条假阻塞。
- **订正规范里一条正在流传的归因**：「重复 PR 的 `受影响用例` 恒红（空改动面退 2）」
  **不成立于 squash 形态** —— 三点 diff 取的是 merge-base，squash 只让内容相同、不改 merge-base
  （实测当天两条已合并分支头：仍给出 7 / 4 个文件，且都不在 master 的祖先里）。那一格真能把面
  判成 0 的条件是「分支头已成为目标的祖先」（非 squash 合并那一档），此时退 2 是正确的阻断。
- 用例（`tests/ship.test.ts`）：`findMergedPullForHeadSha` 一组（sha 逐字命中 / `is_merged=false`
  不算 / sha 不同 / 空 sha / 只有 HTTP 信封 / `data.data` 分页嵌套）+ 整链三格（已落地 ⇒ 不建并退 2、
  关了没合 ⇒ 照常建、读不到清单 ⇒ 念「未判定」并照常建）。生产侧真取数也跑过一次：两个已合并
  分支头分别认回 PR #2237 / #2242，当前 HEAD 不命中。
