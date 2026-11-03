## Changed

**承重流水线迁到 GitHub Actions**：PR 门禁 / 每日档 / 桌包打包的执行者换到 GitHub 托管
runner（镜像仓转公开后 Actions 分钟数免费），CNB 自托管节点只保留它独有的两件 ——
PR 镜像桥（推合成 merge HEAD + `repository_dispatch` 派发）与平台专有读数格。
`.github/workflows/` 下新增/扩写 `pr-gate.yml`（`repository_dispatch` 起跑的五格 PR 门禁）、
`daily.yml`（UTC 17:00 每日档）、`package-desktop.yml`（windows-2022 桌包 + Artifacts
14 天留存，不进 Releases）。

push 档同时补 `GitHub master 镜像` 一格（`ci-github-mirror-push.mjs --master`：探活 +
`--force` 推 `refs/heads/master`，不派发，按 `--readout` 读数档跑）——GitHub 的
`schedule` 恒跑默认分支，master 不镜像过去，每日档每天跑的就是一棵旧树。
公开化前安全自查无阻塞项（在库与全历史无凭据 / 私钥 / 数据库 / 大 blob）。
守护测试同批更新（门格总账 + 镜像脚本 9 条新用例）。
