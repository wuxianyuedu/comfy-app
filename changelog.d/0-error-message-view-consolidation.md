## Fixed

- **视图 / 客户端层错误文案收口到 `~/lib/error-message` 唯一出口（§12.12 / 硬规则 4）**：清掉一批绕过 `errorMessage` 的本地实现与劣化分叉——
  - `use-file-upload.ts`：本地函数**直接命名为 `errorMessage`**（遮蔽 lib 同名出口），且 `errorMessage(err) ?? "上传失败"` 对空 message 得到空串（空串非 nullish）→ 泄漏空白错误；改走 canonical `errorMessage(err, "上传失败")`。
  - `use-generate.ts`：本地 `catchMessage` 对非 Error 抛值产出 `[object Object]` 且绕过网络层翻译；改 `errorMessage`。
  - `render-film-client.ts` / `POST /api/comfy/ensure`：`e instanceof Error ? e.message : String(e)` 的 `String(e)` 分支正是缺陷表里点名的「对象抛值渲染成 `[object Object]`、跳过网络原文翻译」那种；改 `errorMessage(e, 兜底)`。
  - `use-workshop-agent.ts`：`err instanceof Error ? err.message : "工具执行失败"` 换 `errorMessage(err, "工具执行失败")`，获得 tRPC `shape.message` 根因提取。

## Known（后续专项，非本 PR）

- `use-shot-review` / `use-character-review` / `use-material-library` / `use-workflow-detail-loader` 的 `catch { setError(e instanceof Error ? e.message : …) }`：直接把取值换成 `errorMessage` 会触发 UI 基元硬闸 **P27**——因为 P27 要求这段「try/await + catch + 反馈通道」样板整体走 `~/lib/async-action` 的 `runAsyncAction`，而非在 catch 里手拼。这是这些文件的既有 async-action 债（此前用 `instanceof` 内联恰好规避了 P27 检测），正确修法是整体迁 `runAsyncAction`，属独立于错误文案收口的专项，本 PR 不冒进、已回退那四处到原形态。
