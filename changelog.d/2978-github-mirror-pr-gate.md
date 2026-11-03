## Added

- 双远端镜像（cnb 主）单格冒烟（#2978）：cnb PR 流水线新增 `endStages` 一格「GitHub 镜像同步」
  （`scripts/ci-github-mirror-push.mjs`）——把本跑 HEAD 推到 `wuxianyuedu/comfy-app` 的
  `cnb-pr-<IID>` 专属 ref 并派发 `repository_dispatch`；新增 `.github/workflows/pr-gate.yml`
  按**同一笔 sha** 检出并跑「UI/逻辑分离」一格，验证「cnb PR → 镜像 GitHub → workflow」整条链路。
  令牌 `GITHUB_MIRROR_TOKEN` 由平台侧注入，缺席 fail-closed 退 2；回显一律脱敏（硬规则 17）。
  并行双跑期 GitHub 侧是旁路验证档，不阻塞 cnb 合并。令牌经 `imports` 从密钥仓库
  `moon-read/GITHUB_MIRROR_TOKEN`（`envs.yml`，须声明 `allow_slugs`）注入 PR 流水线。

  边界（业主 2026-11-02 拍板 A）：这一格**只负责推 + 派发**，读数止于 GitHub 收下事件
  （`POST /dispatches` 回 204）。GitHub 侧 workflow 跑没跑、绿不绿**不在这一格的量程里** ——
  要念出它就得给令牌加读 Actions 的权，而这一格刻意只要 `contents: write`
  （`scripts/ci-github-mirror-push.mjs` 文件头第 5 条）。旁路那一档的绿由人看仓库页面结。
