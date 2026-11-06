## Fixed

- `pnpm ship --gh-logs <run-id|pr号>` 的仓库坐标错用 origin：`ship.mjs` 从
  `git remote get-url origin` 解析出的 slug 是 CNB 的 `moon-read/comfy-app-t3`，
  原样传给 GH 日志回读后，GitHub API 一律 404（2026-11-05 `42121584357`
  现场：run 本身在 `wuxianyuedu/comfy-app` 上，直接用镜像 slug 可正常取数）。
  现在 GitHub 那一侧只认 `GITHUB_MIRROR_REPO`（缺省复用镜像格的
  `wuxianyuedu/comfy-app`），与 CNB 的 `slug` 彻底分开；`--diagnose` / `--stage-log`
  等仍用 origin slug 的格子不受影响。
- 回归在 `tests/ship-gh-logs.test.ts`：缺省落镜像仓、`GITHUB_MIRROR_REPO` 可覆盖、
  回读第一跳打的 URL 是镜像仓 API 而不是 origin slug。
