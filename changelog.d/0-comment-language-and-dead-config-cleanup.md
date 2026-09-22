## Changed

- **代码注释中文化补齐**（规范 §12.4.6）。`check-comment-language` 此前在 master 上是红的：7 个文件（`use-settings-page-types.ts` / `log-analysis.ts` / `log-types.ts` / `async-action.ts` / `workflow-detail-raw-inputs.ts` / `workflow-param-classes.ts` / `workflow-param-mapping.ts`）的注释里有 12 行「疑似英文句子」—— 实际形态都是**整行只有反引号标识符与 `/` 分隔符**（拆分件的符号清单）或一句英文代码片段。修法是把中文句子的并列分隔改成中文顿号、把英文代码片段补上中文引语，语义不变；门禁回到「0 行」。

## Removed

- **`scripts/db-push-core.mjs` 的 `config` 选项（死参数）**：它的注释指向一份「关掉 `strict` 的 `drizzle.config.autosync.ts`」，而那份配置文件与调用方**都不存在**（`pushSchema` 的唯一两个调用点分别传 `{ force: true }` 与 `{ databaseUrl, force, verifyConvergence, forward }`）。注释会让人以为「自动应用安全变更是靠另一份配置」，实际靠的是输出白名单（`canAutoApply`：只认建表 / 建索引 / 加列）。删选项、并把这条事实写进该函数的注释（判据仍只有一份）。
