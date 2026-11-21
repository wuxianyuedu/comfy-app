## Changed

- 修正 `docs/guides/PRODUCTION-GAPS.md` C1 条目的过期证据（#4312）：原写「全仓 renovate/dependabot/audit/sbom = 0」，但依赖漏洞扫描与自动提单已在场——GitHub 镜像仓 Dependabot + CodeQL、`.github/workflows/dependabot-triage.yml`（#4168）与 `code-scanning-triage.yml` 每日按依赖/规则聚合成 CNB 单（#4307/#4308/#4310/#4311）；`pnpm audit` 棘轮（`check-dependency-audit.mjs`）为按需档。C1 改写为「扫描与自动提单已在场；license 合规 / SBOM / 自动升级（renovate）仍缺」，属 docs/README.md §8.4 状态类事实性漂移修正，不引入新功能。
