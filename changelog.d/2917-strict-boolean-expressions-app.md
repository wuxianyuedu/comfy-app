## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 19：`src/app` 清零
  （115 处 / 35 份）**（ISSUE #2776 / #2917）：按子目录分四组推进——
  settings components 33 处/8 份（AppUpdateSection / ComfyuiSection /
  ComfyuiStoragePaths / DatabaseSection 9 / LlmRemoteSection /
  RemoteModelDialog / UsageTestDialog 9、comfyui-storage-paths-config）、
  settings hooks 16 处/5 份（use-remote-model-dialogs /
  use-settings-page-db-studio / use-settings-page-remote-models /
  use-settings-page 与其用例）、api 57 处/18 份（custom-nodes 8+12、
  materials 9+2、workshop draft 4、production 3+1、comfy/ensure、
  debug/source、llm 3、llm/models、llm/test、llm/ollama-start 4、
  logs/current、logs/sessions、upload、workshop-api/generate、
  workshop-local/prepare）、login / workspace / error / global-error
  9 处/4 份。
  - 口径与前几批一致：可空布尔/可选链布尔 → `=== true`（否定 `!== true`）；
    `string | null` → `!== null && !== ""`；`string | undefined` →
    `!== undefined && !== ""`；三态字符串三重判；`unknown`/`any`/不一致真值
    union 与恒真对象防御 → `Boolean(x)` 显式转换（落 `if` 直接条件位时改
    中转变量，避免触发 `no-extra-boolean-cast`）；判别联合的恒假分支改显式
    `=== undefined` / `!== undefined`。login 页 `||` 改写后顺带删掉原有的一条
    `eslint-disable prefer-nullish-coalescing`（禁用指令总数只减不增）。
  - 验证：逐组改写、逐组重拉复核，`src/app` 整域终扫 0 残留；
    全量 `tsc --noEmit` 绿、`vitest run tests` 绿。
