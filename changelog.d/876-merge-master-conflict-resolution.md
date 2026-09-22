## Fixed

- 并入 `master`（`7e23a584` 工坊写入统一生产模型 Phase 3b-2）并解决 **2 处冲突**：
  - `scripts/.file-size-baseline.json`：取本 PR 侧（`total 0` / `files {}`）——
    本轮的 ollama sub-hook 拆分已让 `use-settings-page.ts` 落到 R5 阈值以下，
    master 侧那条 `966` 是拆分前的中间态；`baselineRev` 保持 `8154d954`。
  - `src/app/(main)/settings/hooks/use-settings-page.ts`：结构取本 PR 的
    sub-hook 形态，master 侧同名逻辑（`ollamaStopping` state / `ollamaLog` /
    `stopOllamaFn` 与 `sleep` / `parseOllamaLogText` import）已由
    `use-settings-page-ollama.ts` 收口，不重复引入。
