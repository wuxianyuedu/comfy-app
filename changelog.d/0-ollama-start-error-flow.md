## Changed

- **按 §12.18 收口 `ollama-start` route 的错误流**：`spawn-error` 回调与主 `catch` 里**逐字重复两遍**的「`e instanceof Error ? e.message : String(e)` + ENOENT/EACCES→安装指引」逻辑，抽成模块内 `ollamaFailureHint(error)` 一处（内部走 `errorMessage`）。两处调用点各减到一行。
  - **信封构造保持手写**：`{ error: result.detail }`（业务失败，无错误对象可提取）与 `{ error: \`启动 Ollama 失败：${hint}\` }`（自定义 hint 合成串）都不套 `apiErrorBody`——后者的契约是「传错误对象、内部 `errorMessage` 取值」，套进来会丢掉 ENOENT 安装指引这层业务判断。P32 也只数 `error: errorMessage(`/`error: apiErrorDetail(`，这两处是模板/变量、非其落点。
  - 行为不变：spawn ENOENT/EACCES 不在网络翻译表里，`errorMessage` 原样回其 message，hint 正则照旧命中。tsc + eslint + P32 + `ollama-client`/`clients` 测试 32 例全过。
