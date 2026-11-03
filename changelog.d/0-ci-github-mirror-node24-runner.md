## Changed

- GitHub 镜像档（`.github/workflows/pr-gate.yml`）收掉两类平台告警：
  - **弃用告警**：`actions/checkout` / `actions/setup-node` / `pnpm/action-setup` 由 `@v4`
    升到各自**第一个声明 `node24` 的主版本**（`@v5`）。GitHub 2026-09-23 起已从 runner
    移除 node20 运行时，`@v4` 会被强制挪到 node24 并在 run 页面刷「Node.js 20 is
    deprecated」；不继续往 `checkout@v6` / `setup-node@v7` 跳——checkout v6 起改了 fork PR
    的检出默认（默认拒绝检出）、setup-node v6 起对 npm 项目自动开缓存，都不是这一格要的
    行为，要跳是单独一次决定。
  - **镜像迁移通知**：`runs-on: ubuntu-latest` 改钉 `ubuntu-24.04`。浮动标签 2026-10-19 ~
    11-19 正从 24.04 分批迁往 26.04，跟着它跑等于让这一格的机器由平台排期决定；换镜像
    应当是单独一次决定（先按 `ubuntu-26.04` 试跑再改）。
