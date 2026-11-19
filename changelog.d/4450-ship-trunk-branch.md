## Fixed

- ship 合并验真后的本地同步跟 PR 的实际 base 走：`checkout` / `pull --ff-only` 用
  按 baseRef 算出的 `trunkBranch`，不再写死 `master`（栈式 PR / 换默认分支时不再
  切错基线）；两步各留一行失败读数——合并验真的结论不变，但「本地没同步成」可见。
  （#4450）
