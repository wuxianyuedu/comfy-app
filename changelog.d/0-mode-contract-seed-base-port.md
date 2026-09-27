## Fixed

- **模式契约层漏登记 seed 基础口，导致内置契约的 seed 口在存盘时被静默丢弃（修既有坏测试 + 潜在数据 bug）**：#949 把种子做成对外参数后，`exposedParamsForMode` 已产出 `seed` 口（id "seed"、label「种子」），`builtInModeContract` 据此把 seed 纳入内置契约的 `inputs`；但契约层的 `MODE_CONTRACT_INPUT_TYPES` / `isModeContractInputId` 从未登记 seed。后果：
  - `builtInModeContract` 吐出一个自己的 `isModeContractInputId` 都不认的 id（违反该文件回归测试锁定的不变式「内置契约每个口都必须是合法契约 id」）；
  - `parseModeContracts` 按 `isModeContractInputId` 剔非法口 → 用户含 seed 的内置契约**存完再读回来就少一口**（正是本文件早先为「带序号参考图」修过的同类静默丢口）。

  把 seed 补进 `MODE_CONTRACT_INPUT_TYPES`（label 同取 `EXPOSED_PARAM_DISPLAY_LABEL.seed`，遵守「展示名一处」约束）+ 补 `CONTRACT_INPUT_TO_ADAPTER` 的 seed 展开（`seed → field "seed"`，TS 穷尽 Record 强制同步）。同步三处因此变陈旧、且互相矛盾的测试期望（「两套 id 互不接受」把 seed 误列适配器专属、内置默认清单与「全部预制口」清单少 seed）。
