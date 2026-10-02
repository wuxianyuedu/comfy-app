## Fixed

- 并入 `master`（`ed6ab4d2`）并解决 **6 处冲突** —— PR 侧要删的「炼丹」链路与
  `master` 侧同期合入的 `c1961bc4`（移除提取「工具·内置规则」通道）**是同源重构的两次
  落地**，`use-character-flows.ts` 因此撞成 add/add：
  - `src/components/workshop/hooks/use-character-flows.ts`（add/add）：取 `master` 版。
    该文件两侧都是 `CharacterDesigner` 的 sub-hook 拆分，`master` 版已含「工具通道移除」，
    PR 版还带着 `useExtractSession("tool", …)` 与三处 `extractChannel === "tool"` 分支 ——
    合起来只能有一份，取较新的 `master` 版。
  - `src/components/studio/NavItems.tsx`：取 `master` 的**四分区**结构（含
    `OVERLAY_NAV_ITEMS` 浮层入口），同时按 PR 意图删掉全局项里的「炼丹」。
  - `src/components/workshop/CharacterDesigner.tsx`：`genSel` 解构随 `master` 版
    （hook 仍返回它），不留悬空变量。
  - `scripts/.function-length-baseline.json`：取 PR 侧的 `4`（实测吻合，`master` 的 `6`
    里含已被本 PR 删除的 `TrainingStudio`）。
  - `src/components/studio/TrainingStudio.tsx`、`src/server/api/routers/train.ts`
    （modify/delete）：PR 删除为准，`master` 侧的改动（`comfyImageUrl` 收口 / `TRPCError`
    信封）在该文件随功能废弃一起消失；前者的 `comfyImageUrl` 修法在
    `WorkflowImagePreview` 等 5 处另有落点，不构成损失。
- 顺带清掉两处**被自动合并放进来、但已被本 PR 废弃**的残留（不会让任何用例变红）：
  `src/server/api/routers/train.test.ts`（`master` 侧 `7c01411d` 新增的 E3 闸门执行者，
  路由既已删除即失去被测对象）、`tests/trpc-surface-executors.test.ts` 的
  `train.detail` 零消费台账条目（棘轮 `MAX_ZERO_CONSUMER` 4→3）。
