## Changed

- **GA PR 档的 `typecheck-db-format` job 加一格全量档格式判据**（`node scripts/check-format.cjs`），
  排在现有 `--changed` 那一格之后：前者判本次 PR 带来的改动面，后者判全库不变式，两格互补。
  缺口形态是「PR 自己改判面」—— 扩 `SCAN_ROOTS` / 删 `IGNORE_GLOBS` / 改 `.oxfmtrc.json`
  时，`--changed` 只看得见被碰的文件（`.oxfmtrc.json` 连 `GLOBS` 都不进），新纳入的存量
  没有任何判决面。依据是真实读数：这一格是**合入前唯一自动执行点**、暴露窗口 0
  （红在合入前，不会先落主干再回补）；本机实测全量档 3.5–4.8s（2107 份判据面，热缓存）。

## Fixed

- 订正 4 处把「冷装约 8 分钟」当作 GA job 成本依据的表述（`pr-gate.yml` / `daily.yml` /
  `package-desktop.yml` 的安装步名、`master-gate.yml` 的超时注释）。前提不成立：今天没有
  8 分钟的安装成本；这个数字曾被用来论证「多跑一格划算」，现在只留可核对的事实
  （装依赖是 job 的大头、时长随 registry 与缓存状态浮动）。
- `check-format.cjs` 头部执行者清单同步：平台侧从 `.cnb.yml` 改为
  `.github/workflows/pr-gate.yml` 的两格；陈旧读数 17.6s 改为复测的 3.5–4.8s。
