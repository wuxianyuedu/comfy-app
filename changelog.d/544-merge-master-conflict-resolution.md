## Fixed

- **PR #544 与 `master` 的合并冲突按「外部抽离优先、被推翻的口径同步收口」解决**：三处冲突里，
  `settings/SettingsPageView.tsx` 是**结构性**冲突 —— `master` 把 2498 行外壳拆成 105 行 + 11 个分区组件
  （`settings/components/*`、`settings-status-row-config`），本分支则是在旧的内联版上改了一行
  placeholder。按「后到的结构重构优先」取 `master` 版，并把本分支那条真实改动（Ollama 默认地址
  改读 `endpoints.ts` 的 `OLLAMA_DEFAULT_BASE_URL`）重新落到**改动迁去的位置**
  `settings/components/LlmLocalSection.tsx` —— 冲突解决不是「选一边」，漏掉这次搬迁就等于
  P3 的「默认地址收口」在合并时被静默丢掉。
- **R5 扫描范围的两份实现收敛成一份**：`master` 的 ISSUE #535 只把 `src/app/` 补进**目录**维度，
  本分支的 ISSUE #536 已把范围扩到**整个 `src/`、不分文件类型** —— 前者是后者要评估掉的中间态。
  冲突处取 #536 的完整口径，删掉 #535 遗留的两条**反向**用例（`src/lib` 不在范围、`.ts` 不在范围），
  它们锁的正是本次要推翻的旧判据；`tests/check-file-structure.test.ts` 里原本会同时存在两套互斥断言的
  describe 也合并成一个。
- **`UsageTestDialog` 因 #536 的函数长度棘轮触发拆分**：`master` 新抽出的
  `settings/components/UsageTestDialog.tsx` 单函数 443 行，一合并就超出 §12.13 的 400 行判据。
  按职责切成 `UsageVideoModeQuickPick` / `UsageFieldEditor` / `UsageTestResultPanel` 三个同级纯展示
  组件（动作仍全经 `d`，非空判据随条件一起搬进组件签名），父组件收敛到 180 行以内；
  棘轮基线顺势收紧 **21 → 20**，`master` 在 `SettingsPageView.tsx` 上的拆分成果被机器记账。
