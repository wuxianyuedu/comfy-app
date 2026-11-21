## Fixed

- **测试模型「打开原始产物（系统浏览器）」不再报 Invalid URL（#4750）**：本地工作流产物是同源相对路径 `/api/generated/<task>/<file>`，而 `setting.openExternal` 的入参是 `z.url()`，相对路径当场 `invalid_format`（更后面 `openUrlInBrowser` 的 `isHttpUrl()` 也只收绝对 http(s)）。`useResultInBrowser`（`use-model-test.ts`）现在用 `getBaseUrl()`（全库 origin 唯一出处）把相对路径补成绝对 URL 再发；已是绝对地址的原样保留，`file:` / `javascript:` 等危险协议仍由服务端协议闸拦下，不放宽安全边界。`use-model-test.test.ts` 补两条用例：相对路径补 origin、绝对地址不改 host。
