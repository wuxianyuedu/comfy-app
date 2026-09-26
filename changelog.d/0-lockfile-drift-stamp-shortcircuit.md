## Fixed

- **每次启动都全量解析两份 lockfile（`scripts/launcher-core/worktree.mjs`）**：
  `lockfileDrift` 每次都把仓库根与 `node_modules/.pnpm` 的两份 ~1.2 万行 YAML 读进来
  跑实质 diff（数百 ms）。现在按两份文件的 `(size, mtime)` 指纹短路：都没变时直接复用
  上次结论 —— `pnpm install` / `git pull` 必然触碰文件、mtime 必变，缓存自然失效；
  读取失败的路径不缓存。
