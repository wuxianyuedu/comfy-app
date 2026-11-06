## Changed

**`COMFY_CI_MAX_WORKERS` 覆盖出口接进 GA workflow（GA 侧适配清单 G-1）**

只开口子、不写数：仓库变量没设 ⇒ 展开成空串 ⇒ `resolveCiWorkers()` 按「没设」走默认推导（GA 实测 2 核 ⇒ `ceil(2/8) = 1` worker）。

- `pr-gate.yml` / `daily.yml` 的 workflow 级 env 加 `COMFY_CI_MAX_WORKERS: ${{ vars.COMFY_CI_MAX_WORKERS }}`
- 实测读数：`[ci-affected] 收尾复述：并发 --maxWorkers=1（2 核，os）`；全量单测 `Test Files 873 passed (873)`，约 629 秒（run 41616389372，2026-11-03）
- 证伪：G-1 上一版「4 CPU / 16GB」「全量单测 ~290 分钟、接近 300m 预算」都不是读数
- 第二臂（覆盖 2）待仓库变量设置后的下一跑；当前令牌只有 `actions: read`（`GET /actions/variables` 与 `POST /dispatches` 均 403）

CNB 侧完全不动。
