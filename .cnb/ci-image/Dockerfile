# 托管机实验格的构建环境（ISSUE #3346）：官方 node 镜像 + git-lfs / cnb CLI 预装。
# 由 `.cnb.yml` 托管机那条流水线的 `docker.build` 消费 —— 平台按 `versionBy` 缓存：
# 这份文件不变就不重建，每条 PR 不再各跑一遍 apt-get（原先那格 15-25s + 一条
# debian 源的出网依赖）。

FROM node:26

RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends git-lfs \
    && rm -rf /var/lib/apt/lists/*

# 推送格只需要 `git lfs push`（不带 smudge/filter 钩子也能推），装完即用。

# PR 标题回读通道（ISSUE #3346）：`ship-exec` 的 `cnbSpawn()` 按名字找 `cnb`，
# 平台池容器里原本没有 ⇒ 标题回读退「PR #号 · sha」老格式。官方 CLI（CNB 官方
# npm 包）装进全局即上 PATH；令牌走流水线自动注入的 `CNB_TOKEN`（get-pull 的
# 读权限与主列同一套），读不到时脚本仍按既有降级形态留空，不影响推送 / 派发。
RUN npm install -g @cnbcool/cnb-cli \
    && cnb --version

