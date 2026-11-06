## Changed

**GA 托管 runner 核数读数更正：2 核 → 4 核（GA 侧适配清单 G-1）**

镜像仓 2026-11-06 已从私有转 public，托管 runner 规格随之变化；清单里「2 核」的读数过期，按最新原始日志更正。只改读数与推导，不改任何配置。

- 新读数（run 42202918718 › affected-tests）：`[ci-affected] 改动面：…；并发 --maxWorkers=1（4 核，os）`
- 推导不变：`ceil(4/8) = 1` ⇒ vitest 仍是 `--maxWorkers=1`；PR #3246 接的覆盖出口在未设仓库变量时行为不变
- 全量单测基线（run 41616389372，2026-11-03，629 秒 / `Test Files 873 passed (873)`）注明是 2 核机器上的读数，只能作量级基线
- 4 worker 那一臂的写入口实测不可用：`POST https://api.github.com/repos/wuxianyuedu/comfy-app/actions/variables` → 403（`Resource not accessible by personal access token`），令牌只有 `actions: read`

CNB 侧完全不动。
