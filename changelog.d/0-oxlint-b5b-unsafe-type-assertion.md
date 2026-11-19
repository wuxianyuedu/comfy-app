## Changed

- **B5 子批 2：20 份 / 39 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批全是 `scripts/*.{mjs,cjs}` 的 CI 工具链：修法沿用子批1 的「运行时校验 + 类型守卫」——
  `JSON.parse` / fetch 回话先落 `unknown`，再经 `isRecord` 谓词逐层取值；catch 里的
  `error.code` 用 `"code" in error` 收窄、消息统一 `error instanceof Error ? … : String(error)`；
  `Object.entries(...).find(...)` 替掉对 `os.constants.signals` 的字符串索引；
  `main.state === "data" ? main.runs : undefined` 替掉 union 上的直接取字段；
  `Timeout` 句柄加 `isTimeoutHandle` 谓词后再 `clearTimeout`。
- 语义未变：判红/退码口径、日志话术、`overrides` 读取行为均逐条保持原样；没有新增
  `as` / `!` / 逐行禁用，没有放宽既有 overrides。
- 台账：B5 行改「清账中（子批1–2：40 份 / 88 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。

Refs #3181
