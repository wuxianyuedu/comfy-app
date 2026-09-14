## Changed

- **`SettingsPageView.tsx` 从 2498 行拆到 107 行（ISSUE #535）**：IO 早在 §17.10 收尾批就进了 `hooks/use-settings-page.ts`，但视图本身仍是全仓库最大的文件（超过 §4.1 的 300 行阈值 8 倍），单文件无法验证、也没有测试覆盖。现在只留「外壳 + 分区路由 + 两条提示条」，各分区搬到 `components/` 下 8 个 `*Section.tsx`：
  - `AppearanceSection`（40）／`UpdateCheckSection`（84）／`AppUpdateSection`（105）／`LlmLocalSection`（286）／`LlmRemoteSection`（165）／`ComfyuiSection`（239）／`DatabaseSection`（119）／`ExitSection`（73）；
  - 共用展示原语（`Card` / `Field` / `Btn` / `AnsiLogText` / `FieldImagePreview`）抽到 `components/SettingsPrimitives.tsx`。

- **远程模型的弹窗交互状态收进第②层 hook `hooks/use-remote-model-dialogs.ts`**：「添加 / 编辑模型」与「实际使用」两个弹窗的表单草稿、进行态、测试结果、额外字段行编辑原本内联在视图里（约 470 行），现在集中成 hook；两个弹窗各自成组件（`RemoteModelDialog` / `UsageTestDialog`），接收**已收窄的非空** prop，由分区组件保证非空。

- **拆分只动 JSX 的物理位置，行为零变化**：对账了 `className` 静态串（225 → 225）与模板串（20 → 20），差异集只剩预期的标识符改名（`comfyDesktopManaged` → 分区内 `desktopManaged`、`testMsg` → `d.testMsg`）与缩进；JSX 中文文案差异集为空。

## Fixed

- **`settings-status-row-config.test.ts` 改为扫描拆分后的分区文件（ISSUE #535）**：其中一组用例直接 `readFileSync("./SettingsPageView.tsx")` 断言三条状态行用了 `STATUS_ROW_CLASS` / `STATUS_ACTIONS_CLASS`，拆分后这些行落到 `LlmLocalSection` / `ComfyuiSection` / `DatabaseSection`，测试同步改扫描目标——否则会在「文件其实没问题」的情况下变红。
