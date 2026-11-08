## Fixed

- **镜像格 egress 判据补认 git-lfs / Go net 的 TCP connect 超时（#3401，PR #3398 首跑现场）**：`ci-mirror-failure-report.mjs` 的 `isEgressFailure()` 原先只认 git / curl / schannel 那一族英文回话，`dial tcp …: connectex: A connection attempt failed` / `i/o timeout` / `no such host` / `connect: connection refused` 这些 Go net 包在出网层抛的措辞一个字都对不上 ⇒ LFS 那一跳被念成「其他」、`shouldRetryGitFailure()` 也不认，60s 墙钟预算重试整档吃不到（日志 `重试=1 次` 即首刀后没再发起）。补进去后话术、重试面、失败分类三者同源认下它；认证 / 配额 / 仓库不存在三族一字未放宽。只补判据与定向用例，不动预算、退避阶梯与承重语义。
