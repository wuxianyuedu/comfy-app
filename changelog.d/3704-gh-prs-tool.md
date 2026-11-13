## Added

- `pnpm ship --gh-prs [状态|PR号]`（#3704）：只读工具，列 **GitHub 仓库侧（镜像仓
  `wuxianyuedu/comfy-app`）** 的 PR —— 号 / 标题 / 作者 / 分支 / mergeable / 网页
  URL。dependabot[bot] 那类只存在于 GitHub 侧的 PR（CNB 侧看不见）从此一句命令
  就能读到；数字入参给单条详情（含标签与正文摘要）。
  - 值可选：缺省 = 开着的；`open` / `closed` / `all` 按状态列清单；数字 = 单条。
  - 令牌三层：`GITHUB_MIRROR_TOKEN` / `GITHUB_TOKEN` 之外，本机 `gh` 已认证时
    直接复用它的 keyring（`gh auth token`），免再配一份 env。
  - 与 `--gh-logs` 同一条纪律：只读、一次只做一件；取数失败只念一行缺因，不改退码。
