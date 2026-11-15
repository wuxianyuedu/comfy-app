## Added

- GA 判决回调 build 带上 PR 标题（`<PR 标题> (#<号>)`，ISSUE #3981）。此前每条回调 build
  在 CNB 构建历史里都叫 `API custom event`，要**点进去**才知道它属于哪张 PR：
  `dto.StartBuildReq.title` 一直是空着的。现在 `pr-gate.yml` 的两条触发形态各把标题取到
  （自动档读 payload、按需档站内读 `GET /{repo}/-/pulls/{n}`），经 `GITHUB_ENV` 交给
  `ci-ga-verdict-callback.mjs` 送进请求体。标题缺席时不送 `title` 键，回落平台缺省 ——
  顺带让 `GET /{repo}/-/build/logs?title=` 这个筛选键从「永远命中不了」变成能用。
