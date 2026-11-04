## Changed

- **GitHub run 列表的标题带上 PR 标题**：镜像格派发时读一次平台 PR 标题（`cnb pulls
  get-pull -v` 的 `data.title`），归一成单行、截到 160 字符，塞进
  `client_payload.pr_title`；`pr-gate.yml` 的 `run-name` 排成 `PR #<号> · <标题> · <sha>`。
  标题缺失（老 payload / 平台读不到 / 标题为空）时回落为原来的 `PR #<号> · <sha>`，
  不产生空标题、也不报错；sha 仍全量留在末尾，`display_title` 认领本跑的锚点不动。
  生成源是本仓的 `.github/workflows/pr-gate.yml`（镜像仓那一份由 `--master` 推送覆盖）。
