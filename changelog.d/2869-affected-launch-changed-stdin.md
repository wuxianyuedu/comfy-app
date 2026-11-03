## Fixed

- **`run-affected-tests.mjs` 现在真的消费 `--changed-stdin`，读不到就响亮退 2（ISSUE #2869）**：
  该旗标此前**既不认识也不拒绝** —— 进了 argv、没有分支读它，改动面仍取暂存区 /
  `COMFY_AFFECTED_CHANGED`。于是 `node scripts/run-affected-tests.mjs --changed-stdin < 清单`
  **静默退回固定清单**：看着全绿，这一份改动对应的用例一条没跑（假绿）。

  改动：

  1. 新增 `scripts/affected-launch-carrier-flags.mjs`，在启动器入口做载体判决：
     - `--changed-stdin` 读 stdin（一行一个路径），归一进下游唯一载体
       `COMFY_AFFECTED_CHANGED`（清单那一跳与归因建议同读它，不另造第二个入口）；
     - stdin 是终端 / 读不到 / 读出来为空 ⇒ **退 2 并打印原因**，绝不降回固定清单
       （空集会让启动器跑成全量，而「全量绿」在本地预检里正是被规范否掉的读数）；
     - `--full` 与 `--changed-stdin` 互斥 ⇒ 退 2；
     - 不认识的非空 `--*` 旗标 ⇒ 退 2 并点名（拼错一个旗标与没写不能长得一样）。
  2. `run-affected-tests.mjs` 只在入口落这一步的退出码（判决与话术收进新模块，
     启动器仍在 900 行硬闸内）。
  3. 新增三条用例钉住两条路径：有 stdin 时结果与 `COMFY_AFFECTED_CHANGED` 载体
     **逐字相同**、空 stdin **退 2**、陌生旗标 **退 2 并点名**。

  实测（本机）：

  - 有 stdin：`"tests/ship.test.ts" | node scripts/run-affected-tests.mjs --changed-stdin --dry-run`
    ⇒ `改动面自 stdin：1 条（已归一进 COMFY_AFFECTED_CHANGED）` / `91 个用例 / 5 次启动` / exit 0；
  - 空 stdin ⇒ `--changed-stdin 读到的清单是空的 ⇒ 退 2` / exit 2；
  - 陌生旗标 ⇒ `不认识的旗标 --changed-files=… ⇒ 退 2，不猜` / exit 2。

  验证：`vitest run tests/affected-tests.test.ts` 46 通过（新增 3 条）；
  `eslint` 三份改动文件 `--max-warnings 0` 通过；`check-infra-file-size` 350 文件 0 超限。
