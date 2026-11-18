## Added

- **CI 配方：`base_sha` / `head_sha` / `merge_tree` 三元组成为 CNB⇄GA 对账的幂等键**（ISSUE #4300）。
  镜像链路里 CNB 侧判的是平台合成的 merge 提交，两次派发之间分支与 master 都会动，合并提交的
  sha 每次都不同 —— 「两边判的是不是同一份内容」改由 tree 指纹回答：镜像 payload 新增
  `merge_tree`（`git rev-parse HEAD^{tree}`），镜像日志打印配方；GA `pr-gate.yml` 四个门禁 job
  检出后跑新增的 `ci-mirror-recipe.mjs`，打印同一套字段名的配方并**逐字核对检出树 ==
  payload.merge_tree**，不一致即 fail-closed 红（典型现场：payload 的 `head_sha` 缺失导致
  checkout 静默回落镜像 master HEAD，过去那种跑会静默判错树）。`merge_tree` 缺席（老 payload /
  手动档）只打印配方、不核对，不把没有指纹的旧形状判红。
