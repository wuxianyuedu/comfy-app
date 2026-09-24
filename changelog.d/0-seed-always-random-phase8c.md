## Changed

- **自主出图统一「种子默认随机」**：此前（#949）run-engine 的 `execImages` 只在**抽卡重出**
  （该镜此前已被本 run 处理过、如今 rev 变新）时给一个新的随机 seed，首刷不带 seed、用工作流图内
  配置。按「种子算高级输入、默认随机」的口径，改为**每次自主出图都带一个新的随机 seed**（首刷与
  抽卡重出一致），让同提示词每次重跑都能换图。
  - seed 仍只经「种子」**对外参数**下发（`synthesizeFirstFrame` → `createWorkflowRunTask` →
    `buildEncapsulatedInputs` → `applyParamMapping`），落到作者在工作流里连好的 seed / noise_seed
    端口上；作者没连这一口则落进 `unmatched`、不写任何节点，工作流用其图内 seed——**运行期绝不直接
    改写工作流节点**（不动 `control_after_generate`、不注图内 seed），与「工作流只接受其 IO 参数」一致。
  - 顺带修正 `execReviewShots` 文档注释里一处过期描述（退回重出仍写作已删除的 `randomizeSeed` 机制）。

## Tests

- `run-engine.test.ts`：首刷用例改为断言带一个有限数字 seed（原断言「首刷不带 seed」）；抽卡重出用例
  的随机 seed 断言保持不变。
