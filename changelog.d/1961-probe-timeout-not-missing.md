## Fixed

- **探针超时被当成「这个命令不存在」—— 满载节点上 E2E 报「PATH 上没有可用的 Python」**
  （ISSUE #1961）。

  读数（`cnb-5fd-1k50s26f3`，同一次构建、同一台节点 `orange-connector`）：

  ```
  06:49:21  Python 可用性      ok python --version → Python 3.12.10
  06:49:21  Python 探针读数    resolvePython: ok python → D:\Program Files\Python312\python.exe
  07:07:45  E2E 关键流程       ✗ PATH 上没有可用的 Python（试过 python / py / python3）
  ```

  三次探的是**同一台机、同一个解释器**，差别只有那一刻机器有多满 —— E2E 是排在
  `单元测试`（723s）与 `生产构建` 之后的最后一步。

  机制在 `realUsabilityProbe.spawn`：`spawnSync` 撞上自己的 `timeout` 会给
  `error.code = "ETIMEDOUT"`，那是一个**非空** code，于是 `usableCommand` 按
  「不可用」处理、候选被跳过；候选全跳过 ⇒ `whichCommand()` 返回 `null` ⇒
  上层读成「命令不存在」。**拿不到测量被当成了测量结果。**

  修法两件同批：

  - 判据层：`usableCommand` 里 `ETIMEDOUT` 按**可用**返回（放在判据而不是默认探针里，
    这样注入探针的单测也走同一条规则）。「起了一次、明确失败」（`ENOENT` /
    `EACCES` / `EINVAL` / `ENOEXEC`）照旧算不可用 —— 两件事不混。
  - 预算层：探针超时 10s → 30s（正常 `--version` 是几十毫秒，30s 仍远小于单条 stage 墙钟）。

  回归判据：`python-resolve.test.ts` 新增一组「超时按可用算 / 明确失败照旧算不可用」，
  两向都钉住。
