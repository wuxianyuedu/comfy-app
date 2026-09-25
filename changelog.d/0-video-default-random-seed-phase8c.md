## Changed

- **成片视频 autopilot 也「默认随机种子」**：延续 #957（Agent 逐镜生图每次带随机
  seed）的口径，把 `film/orchestrator.generateVideoShot` 的两跳出图——合成首帧图
  （`synthesizeFirstFrame`）与视频工作流（`createWorkflowRunTask`）——都改为每次带一个
  新的随机 `seed`，同提示词重跑也能换镜。
  - seed 仍只经「种子」**对外参数**下发（`buildEncapsulatedInputs` → `applyParamMapping`），
    落到作者在工作流里连好的 seed / noise_seed 端口；作者没连这一口 → 落进 `unmatched`、
    不写任何节点，工作流用其图内 seed。**运行期绝不直接改写工作流节点**。视频模式本就
    在契约里带「种子」口（`workflow-exposed-params`），与图类同一口径。
  - 该链路只在成片 autopilot（`startFilm` 逐镜循环）走到，是自主生成、不承担单镜可复现；
    films 此前也不落任何 seed，故不存在「改随机会破坏既有复现」的问题。

## Added

- 新增共享随机种子原语 `src/lib/comfyui/random-seed.ts`（`randomSeed()`，非负、
  `[0, Number.MAX_SAFE_INTEGER)`）：此前同一表达式在 `run-engine.ts`、`raw-overrides.ts`
  各抄一份，按 §12.18「跨模块通用能力补进地基写一次」收口；`run-engine` 与本次视频链路
  一律 import 它（`raw-overrides` 的 `control_after_generate=randomize` 兜底属另一处
  构建期用途，未一并迁移）。

## Tests

- 新增 `random-seed.test.ts`（值域/整型/非常量）与 `orchestrator.test.ts` 的 `startFilm`
  用例（首帧图与视频两跳出参都带有限数字 seed）。
