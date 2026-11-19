## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 12：
  `src/components/studio/comfyui` 清零（25 处 / 4 份）**（ISSUE #2776 /
  #2917）：ComfyUI 运行页一族 —— 纯派生模块（comfyui-control-config：
  `status?.up / starting / stopping / probing` 的可选链布尔统一 `=== true`，
  `base` / `via` 的 `string | null` 显式判空，`instance?.pathConfigured`
  改 `=== true`）、视图（ComfyuiControlView：`running` 派生、两颗「打开」
  按钮的 `status?.probing !== true`、启动 / 关闭按钮文案的
  `status?.starting / stopping === true`、`configHint` 显式判空）、业务
  hook（use-comfyui-control：`cached` / `base` 的 `string | null` 显式判
  三处、`comfyLogActive` 的 `data?.starting === true`）与测试
  （use-comfyui-control.test 的 `sessionId` 显式判）。
  - 口径与前几批一致：可选链落 `boolean | undefined` → `=== true` /
    `!== true`；`string | null` → `!== null && !== ""`。
  - 一处收窄写法：`comfyStatusText` 的 `if (status?.up === true)` 分支内需
    继续读 `status.base / via`，而 `=== true` 不产生 TS 收窄，故该处改写
    为 `status !== null && status.up`（`status.up` 本即 `boolean`，规则
    允许），保持收窄与语义逐值等价。
  - 实测口径说明：清单记 25 处，实测 25 处 / 4 份，处数一致，份数以实测
    为准。
  - 验证：`src/components/studio/comfyui` 该规则复测 0 残留（改完后重拉
    复核）；`tsc --noEmit` 全量通过；该目录 2 份测试 27 用例全绿。
    eqeqeq 台账 0 新增、oxlint 禁用台账 0 处。
  - 剩余总量 550 处 / 219 份（components 281 / tests 142 / app 115 /
    config 9 / trpc 2 / tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
