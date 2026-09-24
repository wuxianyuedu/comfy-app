## Changed

- **抽卡重生成的种子改走「种子」对外参数，不再改工作流的 `control_after_generate`**：
  此前（#942 初版）为让「同提示词抽卡」换图，在提交前给采样器节点注了一条
  `control_after_generate="randomize"` 覆盖 —— 但那是**工作流作者自己配置的 seed 控制模式**，
  运行期去改写它等于越权改动工作流意图。改为：尊重工作流配的 seed（`control_after_generate`
  一律不动），把「种子」做成一个**对外参数口**，由作者决定要不要在工作流里连上它。
  - 契约层新增 `seed` 对外参数（`workflow-exposed-params` 的 `ExposedParamClass` +
    `workflow-param-classes` 的 `ParamClass`，数值族；`workflow-param-mapping-ui` 的标签/配色）。
    作者在工作流库「画布节点」把「种子」口连到采样器的 seed / noise_seed 行，工坊才能按次指定种子。
  - `WorkshopExposedValues` 加 `seed?: number`；`toContractValues` 把 seed 落到作者连的「种子」口，
    `exposedValueOf` / `withExposedValue` / `pruneEmptyExposedValues` 一并支持（数字口，空值清掉）。
    **作者没连这一口 → seed 落不下去、进 unmatched，工作流用其图内 seed** —— 实际是否可换由工作流决定。
  - `synthesizeFirstFrame` 加 `seed?`；run-engine 的 `execImages` 只在**抽卡重出**（该镜此前已被本 run
    处理过、如今 rev 变新）时传一个新的随机 seed；首刷不注 seed，用工作流图内配置。
  - 删除 `raw.ts` 的 `findSeedWidgetNodeIds` 与 `createWorkflowRunTask` 的 `randomizeSeed`/
    `control_after_generate` 注入 —— 不再从运行期改写工作流的 seed 控制。

## Tests

- `workflow-exposed-params.test.ts` / `workflow-param-mapping.test.ts` / `workflow-library-param-cards.test.ts`：
  各模式的契约口清单加入「种子」。
- `workflow-encapsulation.test.ts`：种子口连了才落、没连进 unmatched、数字读写、pruneEmpty 保留 0。
- `run-engine.test.ts`：首刷不注 seed、抽卡重出（rev 变新）带一个随机 seed。

## Fixed

- **`CharacterReviewButton.tsx` 的两处 `space-y-*` 迁到 `flex + gap`**：#943 落地的角色卡评审弹窗
  赶在 P70 硬闸（全库 `space-y-*` 清零）之前，遗留两处 `space-y-*` 现被 P70 拦下；本 PR 顺带补齐
  （与 `ShotReviewDialog` 同款 `flex list-disc flex-col gap-*` 写法）。
