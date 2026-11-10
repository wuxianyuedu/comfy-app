## Changed

- **B5 子批 23：20 份 / 64 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；挂账注记 62 处，实扫 64 处，+2 为代码漂移，按实扫清零）。本批覆盖 `server/film`（compose-film / orchestrator）、`server/workshop`（comfyui / api-channel / llm / draft-repository / production-bridge / repository）、`server/mcp/workshop-mcp` 及 11 份测试（`server/lib` 的 request-body / audit、film / workshop / mcp 用例，tests 的 a11y 两档、affected-launch-separation、agent-index、app-port 两档）。
  - 业务侧仍是「运行时校验 + 类型守卫」：外来 JSON / DB 文本列先落 `unknown`，用 `~/lib/is-record` 的 `asRecord` / `isPlainRecord` / `isUnknownArray`、本地 `v is T` 数组守卫、逐字段 `typeof` 校验收窄；非法值按既有默认回落（`short_video` / `IDLE` / `81` / `49` / `16` / `""` / `[]`），合法输入结果不变。
  - **同批地基**：`ShotStatus` 的词表与守卫提升进 `~/lib/film/film-status.ts`（`FILM_SHOT_STATUSES` + `isFilmShotStatus`，类型由词表派生），替掉 `compose-film.ts` 里新写的本地副本 —— 词表与类型同源，不落第二份定义。其余复用既有 `isProjectType` / `parseDraftDto` 的 `isSceneList` 等守卫。
  - 测试侧：`declare global` 环境声明（`__REJECT_INSERT__`）、带签名的 `vi.fn` / 最小合法 mock 回执行、`require` 结果过 `isJudgeModule`、JSON.parse 结果先落 `unknown` 再过逐字段守卫、`isErrorResponse` 收窄后直读 `Response`。
  - **没有新增** `as` / `!` / `@ts-ignore` / `oxlint-disable` 逐行禁用；全批无「豁免不计入清零」的例外。旧 `/* SAFETY: 类型断言已复核 */` 注释随命中断言一起删除（8 条未被规则命中的安全断言按最小改动保留）。
- **台账滞后同批补齐**：`docs/audits/2026-11-04-oxlint-t1-burndown.md` 里 225 行「挂账」实为已清（B5 段 200 行历史批次漏改 + 本批 20 行 + B4 段 5 行同源滞后），200 份差异文件用单规则探针实扫为 0 命中、判决面配置复算亦 0 命中，确认是状态列滞后而非漏登记；总览 B5 行同步为「子批1–23：460 份 / 1155 处已清」。
- 判决面剩余 **150 份 / 350 处**；其中 `scripts/session-report.mjs` 与 `tests/session-report.test.ts` 是上一批代码漂移新增、台账未登记的两行（各 1 处），沿用上一批「按实扫清零、留待登记」口径，下批处理时同批补登记。
