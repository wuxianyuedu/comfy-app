## Added

- 双远端镜像（cnb 主）单格冒烟（#2978）：cnb PR 流水线新增 `endStages` 一格「GitHub 镜像同步」
  （`scripts/ci-github-mirror-push.mjs`）——把本跑 HEAD 推到 `wuxianyuedu/comfy-app` 的
  `cnb-pr-<IID>` 专属 ref 并派发 `repository_dispatch`；新增 `.github/workflows/pr-gate.yml`
  按**同一笔 sha** 检出并跑「UI/逻辑分离」一格，验证「cnb PR → 镜像 GitHub → workflow」整条链路。
  令牌 `GITHUB_MIRROR_TOKEN` 由平台侧注入，缺席 fail-closed 退 2；回显一律脱敏（硬规则 17）。
  并行双跑期 GitHub 侧是旁路验证档，不阻塞 cnb 合并。
