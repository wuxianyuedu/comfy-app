## Changed

- **lint 依赖瘦身（#2777 PR-C）**：删掉只服务「已迁走规则面」的 5 个 devDependency
  （`eslint-config-next`、`@eslint/js`、`@eslint/compat`、`eslint-plugin-unicorn`、
  `typescript-eslint`），换成承托策略守卫的 5 个直接依赖（`@typescript-eslint/parser`、
  `eslint-plugin-react`、`eslint-plugin-react-hooks`、`@next/eslint-plugin-next`、
  `eslint-plugin-jsx-a11y`）。`lint` 仍是 `lint:oxlint && lint:policy` 两档，
  `lint:policy` 仍只有那 16 条，两档都在 `check:premerge` 里；**不删 eslint 本体**。
- `scripts/check-eslint-exemptions.cjs` 的取数从同进程 `eslint` `Linter` 改调
  `oxlint --format json`（最小临时配置落 `os.tmpdir()`、`finally` 删除），
  eslint 依赖的最后一处运行期 API 摘除。解析失败（诊断没有 `code`）与
  `number_of_files` 少于应扫份数都判「没结论」，不退化成「没命中」。
- 清掉一条已陈旧的豁免台账（`tests/no-platform-ci-config.test.ts` 已不含控制字符正则）
  与重复的 `video-task-util.ts` 配置块 —— 新判据第一次跑就把它量了出来。
- 文档：`AGENTS.md` 新增「lint 判据：oxlint 判决 + 策略守卫」一节（两档关系、16 条清单与
  理由、依赖最小集、复审条件、已知限制）；`README.md` 根目录用途表跟上。
  `eslint.config.js` 与 `check-a11y-rules` 改为直接 `import` 插件包，不再经
  `eslint-config-next` 中转。
