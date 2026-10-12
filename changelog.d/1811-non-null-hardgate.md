## Changed

- **非空断言 `!` 从棘轮翻成硬闸（ISSUE #1811 的第三刀，接着 #1815 / #1818）**：
  `scripts/check-non-null-assertions.cjs` 的存量从 **160 处 / 69 文件清到 0**，
  删掉基线文件与 `--update` 支，命中即退 1。`RULE_VERSION` 2 → 3。

## Fixed

- **`!` 一族里夹着三处真 bug，随清理一并修掉**：

  - `repository-user.ts` 的 `updateEmail` / `updatePassword`：`rows[0]!` 在
    `returning()` 匹配 0 行时把 `undefined` **冒充成 `User`** 传下去，
    调用方要读到 `.email` 才炸、栈里早看不出是哪条 SQL。改为抛 `NotFoundError`
    （与 `DrizzleRepository.update` 既有惯例一致）。
  - `workflow-editor-build-nodes.ts` 的 `layoutBoundaryPins`：`inputs[i]!` /
    `outputsRelYs[i]!` 配的是**两个长度未必相等的数组**（pin 清单 vs 算出来的 y），
    越界时把 `undefined` 当 `number` 传给 `buildBoundaryPinNode`，坏的是一张画布。
  - `custom-nodes/route.ts`：`pyCandidates[i]!` 在「越界即无解释器」那一支
    多写了半段死代码；`.at()` 与判据合成一处后，那一支只剩一份。

## Fixed（顺带清掉的三处「假定的环境」）

- **三份门禁自测的临时仓库没关 `commit.gpgsign`**：
  `premerge-push-trigger.test.ts`（3 条用例）、`ast-gates-aggregate.test.ts`、
  `deps-freshness-gate.test.ts` 都在临时仓库里 `git commit`，却只配了身份。
  宿主（开发机 / CI 容器）全局开着 `commit.gpgsign` 而没有可用密钥时，
  这三处退 128（`gpg failed to sign the data`）—— 报错还指不到夹具。
  夹具**不许假定读者的 git 配置**（台账 R12-01 / ISSUE #1817），
  身份与签名策略一并就地钉死。同仓另几处（`gate-repo.ts`
  的 `mkGitRepo`、`check-reformat-only.test.ts`、`check-file-structure.test.ts`）
  早就这么做了，这三份是漏网的。

## Added

- **`scripts/check-non-null-assertions.cjs` 加 `LEGIT_SITES`：逐条登记合法形态**，
  这是这条判据**唯一**的例外车道（与 `check-click-keyboard` 的 `EXEMPT_SITES` 同构）。
  登记的是 `RegExpExecArray` 的捕获组（`m[2]!` / `match[1]!`）与 drizzle 的
  判据构造（`or(...)!`）：它们的下标/返回值**在结构上必然存在**，`!` 不是省略
  判据而是唯一准确的表达（写 `?? ""` 会把「匹配到了但组是空」一起吞掉）。
  键是**「文件 + 变量名 + 组下标」而不是行号** —— 行号会随无关改动漂移，
  漂了就等于没登记。
- **`src/lib/core/repository-row.ts`**：Drizzle `returning()` 结果取首行的
  唯一出口（`firstRowRequired` = 写入路径缺席即内部故障；`firstRowOfExisting`
  = 按 id 更新缺席即 404）。此前 15 处 `rows[0]!` 各写一遍，其中两处如上所述
  会把缺席静默放行。

## Changed（判据与车道）

- 两张尺寸预设表 / 两张视频预设表 / 比例标签表 / `CHARACTER_ATTRIBUTES` /
  `MOCK_SHOTS` / `STATUS_STYLE` 的首档标成**非空数组**或**具名默认值**：
  「`find` 没命中就回退首档」不再需要在每个调用点补 `!`（`noUncheckedIndexedAccess`
  下 `T[]` 的 `[0]` 恒为 `T | undefined`）。`DEFAULT_DIM_RATIO_PRESET` /
  `DEFAULT_DIM_CLARITY_PRESET` / `DEFAULT_ASPECT_RATIO_LABEL_PRESET` /
  `DEFAULT_VIDEO_DURATION_PRESET` / `DEFAULT_VIDEO_QUALITY_PRESET` /
  `QUEUED_STATUS_STYLE` / `OK_STATUS_STYLE` 是「首档是什么」的唯一出处。
- `workflow-preview.ts` 里 `buildWorkflowPreview` 与 `buildWorkflowPreviewFull`
  各抄一遍的「收连线 + Kahn 最长路径分层」抽成 `buildGraphTopology`（§12.12 的
  孪生），顺带把那一族的 `outAdj[id]!` 收掉。
- `layoutLibraryNodes` 的返回类型收成 `LibNodeLayout`（四个固定键，不是索引
  签名），`buildLibraryNodes` 的 `at[id]!` 因此不必再补 `!`。

## Verified

- `.githooks/pre-commit` 全部通过、`pnpm check:premerge` 全绿
- `tsc --noEmit` / `eslint` 干净
- `tests/check-non-null-assertions.test.ts` 8 条（含两条新的断头用例：
  「登记表只放行登记过的形状，换个变量名照计」与「`--update` 不落盘任何 JSON」）
- 涉及模块的用例全绿：`src/lib/core` 195、`src/lib/comfyui` + `media` 等 953、
  `src/components/studio` + `workflow-form` 等 2351

Ref: #1811
