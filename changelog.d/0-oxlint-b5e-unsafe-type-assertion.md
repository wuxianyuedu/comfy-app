## Changed

- **B5 子批 5：20 份 / 40 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是 API 日志族（`src/app/api/logs/**`）与几处路由/组件（`llm`、`materials`、`production`、
  `schema`、`upload`、`RunControlBar`、`message-center`）。修法仍是「运行时校验 + 类型守卫」：
  - `request.json()` / `res.json()` 先落 `unknown`，用 `isPlainRecord` / `Array.isArray` / `typeof`
    逐层收窄；形状不符时走既有 `throw` / 400 出口。
  - Errno 读取改 `isRecord(error) && error.code === "ENOENT"`，不再 `(error as NodeJS.ErrnoException)`。
  - 枚举型（`RuntimeLogSource`、日志 level、`LLMProviderType`/`TaskType`、`ApprovalMode`、
    `MessageKind`）改白名单数组 + 本地谓词，多处复用同一谓词。
  - `formData.get(...)` 的 `FormDataEntryValue | null` 用 `instanceof File` / `typeof === "string"`
    收窄，原有 400 分支保持不变。
  - 测试里的 `NextRequest` 断言改为真 `new NextRequest(...)`；mock 形状用本地谓词或 `vi.mocked`。
- 语义未变：错误码、正常回话形状、日志话术与用例期望值均保持；没有新增 `as` / `!` /
  逐行禁用，没有放宽既有 overrides。
- 台账：B5 行改「清账中（子批1–5：100 份 / 236 处已清）」。

## Fixed

- `tests/worktree-location.test.ts` 的扫描读取改为只降级 ENOENT：并发用例
  `tests/global-setup-cleanup.test.ts` 会在 `tests/` 下造 `.setup-cleanup-probe-*.test.tsx` 再删掉，
  「列目录 → 读内容」窗口与扫描相撞时 `readFileSync` 抛 ENOENT，把这条判据判红（本次 CI 的
  实际失败格）。与 `scripts/gate-scan-read.cjs` 共享读取器同一条口径，非 ENOENT 照冒。

Refs #3181
