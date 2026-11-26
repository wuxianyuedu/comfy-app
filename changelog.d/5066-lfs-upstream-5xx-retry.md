## Fixed

- **镜像格把 git-lfs 上游 502 误判为「其他 / 重试 0 次」**（ISSUE #5066）：git-lfs 是 Go 写的，
  batch 回话走的是 `Server error &{...} from HTTP 502` 形状，既不是 `Internal Server Error`、
  也没有 `remote: HTTP 5xx` 前缀 —— `isTransientRemoteFailure()` 的旧正则一条都不命中，
  于是 `shouldRetryGitFailure()` 不重试、`classifyLfsPushFailure()` 落 OTHER，一跳交账、不派发 GA，
  PR 门禁整格红（PR #5065 连续两跑撞同一形态，与改动内容无关）。
  把这一形按现场原话补进远端瞬时错判据（`server error … from HTTP 5\d\d`，只认 5xx）：
  上游 502 在既有墙钟预算内自动重试，认证 / 权限 / 仓库不存在仍不重试、LFS 失败不派发的安全口径不变。
  补一条按原话的正控与认证 / 配额 / 404 / 200 的反控，以及一条 `runGitWithRetry()` 的「不再单次即弃」用例。
