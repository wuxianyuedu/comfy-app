## Fixed

- **`tests/ship-gh-logs.test.ts` 出站计数改按 hostname 精确判断（ISSUE #3484）**：
  mock fetch 里 `url.includes("api.github.com")` 属于不完整的 URL 子串消毒
  （CodeQL `js/incomplete-url-substring-sanitization`，high）——该字串出现在
  路径 / 查询串 / 伪造后缀主机里同样会被误计。改为
  `new URL(url).hostname === "api.github.com"`，与这条用例「数打到 GitHub API
  的请求」的语义精确一致，断言与其余行为不变。