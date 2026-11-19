## Changed
- CI（第二批 · 翻承重，#3051 期望第 3 条落地）：摘掉 `.cnb.yml` 主列 `GitHub 镜像同步` 与 `GitHub 判决回读` 两格的 `--readout`，从「读数档（恒不退非零）」翻成 **fail-closed 承重档**。现在这两格的退码真正承重：镜像推不出去 / 派发失败 ⇒ 退非零直接拦下 PR 合并；GA 跑完且红 ⇒ 回读格 exit 1 拦合；只有 GA 读到绿才放行；没跑起来 / 没结论 ⇒ exit 2 同样拦合。egress 间歇断流不再致命 —— 三跳 git 调用各自带超时并对 egress 类失败带退避重试（`ci-github-mirror-push.mjs` 的 `REMOTE_PROBE_TIMEOUT_MS 30s×3` / `PUSH_TIMEOUT_MS 240s×2`），真实抖动下重试一次即通（PR #3162 第二跑 8.5s 派发成功、重试 1 次）；只有**持续**不通或 `GITHUB_MIRROR_TOKEN` 被拒才真正退非零。

## Fixed
- 注释口径：`.cnb.yml` 与 `tests/no-platform-ci-config.test.ts` 中把这两格描述为「读数档、恒不退非零、翻承重是另一批」的注释已过时（本批摘了 `--readout`），改为如实描述 fail-closed 承重语义。
