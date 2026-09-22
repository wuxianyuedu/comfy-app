## Changed

- **`src/app/(main)/settings/hooks/use-settings-page.ts` 拆出共享类型与常量**：
  主文件 1331 行超过 §12.6 文件长度棘轮的阈值（--strict 违规、比基线 1450 在
  baselineRev 提交上重数为 1293、当前 1332 多 39）。抽出共享类型与常量到
  **`use-settings-page-types.ts`**（295 行，叶子）：`Settings` / `LlmConfig` /
  `QueryLlmConfig` / `Section` / `OllamaStatus` / `FlashMessage` /
  `SettingsPageDrafts` / `SettingsPageController` / `ReadySettingsPageController`
  9 个类型 + `SETTINGS_SECTIONS` / `TEMPERATURE_TASKS` 2 个纯配置常量。
  主文件保留 `useSettingsPage` hook 本体与兜底缓存 helper（`FLASH_MS` /
  `NO_FLASH` / `SETTINGS_CACHE_KEY` / `readSettingsCache` /
  `writeSettingsCache` / `mergeExtraModels` / `OLLAMA_START_POLL_*`）——
  这些都还跟 hook 的状态紧密耦合，下一轮再按 Comfy / Ollama / DbStudio /
  Update / RemoteModel 五组动作拆 sub-hook 时才顺。
  主文件通过 `export * from "./use-settings-page-types"` 把类型与常量**原样
  再导出**，消费者 `from "./hooks/use-settings-page"` 的路径**完全不变**
  （§12.18 复用优先）。

  `use-settings-page.ts` 1331 → 1078 行（-253 行 / -19%）；
  `scripts/.file-size-baseline.json` 里基线从 1450 降到 1078。
  `check-file-structure --strict` 里 use-settings-page.ts 不再判违规
  （1078 已在 baselineRev 重数 1293 之下）。tsc 绿；`src/app/(main)/settings` +
  `src/components/ui` 共 **41 测试文件、452 用例**全过；
  `check-circular-deps` / `check-function-length` / `check-non-null-assertions`
  / `check-void-floats` 四门全绿。

## Fixed

- 拆走类型后主文件的 5 处 import 变成「只出现在 import 行、body 再无消费方」
  （`RemoteProbeResult` / `UsageTestResult` / `TASK_TYPES` /
  `RuntimeLogController` / `SettingsPageDrafts`）—— tsc `noUnusedLocals`
  当场报错。清理这 5 处；剩余仍被 body 用到的（`OllamaModel` /
  `UsageTestInput` / `UsageTaskQueryInput` / `Section` / `LlmConfig` /
  `Settings` / `QueryLlmConfig` / `OllamaStatus` / `FlashMessage` /
  `SettingsPageController`）保留。同时删掉此前一直挂着的空 `import {} from
"~/lib/clamp"`。
