# 托管机实验格的构建环境（ISSUE #3346）：官方 node 镜像 + git-lfs 预装 + cnb CLI。
# 由 `.cnb.yml` 托管机那条流水线的 `docker.build` 消费 —— 平台按 `versionBy` 缓存：
# 这份文件不变就不重建，每条 PR 不再各跑一遍 apt-get（原先那格 15-25s + 一条
# debian 源的出网依赖）。

FROM node:26

RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends git-lfs \
    && rm -rf /var/lib/apt/lists/*

# 推送格只需要 `git lfs push`（不带 smudge/filter 钩子也能推），装完即用。
#
# `push 失败立案`（同一条流水线的 endStages）经 `ci-pr-failure-issue.mjs` 的判决链
# 起 `cnb` 子进程读构建列表 / 逐格详情并写单：容器里没有这个二进制时那一格会
# 「取不到读数、一次都不写」（`--no-block` 折成退 0）⇒ 绿着空转，比红更坏。
# 装全局 CLI 用的是镜像自带的 npm（不是仓内 pnpm 那套，硬规则 1 管的是仓库口径）；
# 平台按事件注入 `CNB_TOKEN` / `CNB_API_ENDPOINT`，无需登录（官方 `zh/develops/cnb-cli.md`）。
RUN npm install -g @cnbcool/cnb-cli && cnb --version

# `ship-exec.mjs` 的 `makeRunner()` 在 Linux 上按 PATH 找 `cnb`；上面那一装就在
# /usr/local/bin 下，探针 `cnb -v` 通 ⇒ `cnbSpawn()` 不会退化成「起不来」。
