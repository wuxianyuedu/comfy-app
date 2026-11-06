## Changed

**GA 侧 `NODE_OPTIONS=--max-old-space-size` 的口径定为「只在有 OOM 读数的 step 给」**（GA 侧适配清单 G-2）

全仓 `.github/workflows/` 只有一处 `NODE_OPTIONS`：daily.yml 的 ESLint（4096，注释记着这一格
OOM 过）。上一版清单建议「tsc / ESLint / vitest 统一加 4096」是推断，没有 OOM 读数支撑；
无症状的 step 抬堆上限只会掩盖真实内存回归。

因此本主题**不新增任何 `NODE_OPTIONS`**：其余 step 等出现 `heap out of memory` 再按现场加，
并在该 step 注释里记读数出处。CNB 侧完全不动（任务 3 并行期纪律，§13.5.34）。
