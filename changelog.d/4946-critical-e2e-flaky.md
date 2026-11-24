## Fixed

- **两条 @critical E2E 的 flaky 定性与修复**（#4946）：① `view-tabs` 的色条透明度与 `shell-title-bar` 的折叠左缘断言，都是在 CSS transition（色条淡出 / 侧栏宽度 200ms）未收敛时采样的中间值——断言前改为 `expect.poll` 等动画收敛到位再取值，不靠抬超时掩盖；② 本地复跑的「Ctrl+K 打不开命令面板」是水合竞态：快机上 `load` 早于 React 挂载，热键监听还没挂上时按键被整颗丢掉——support 助手先等侧栏容器挂载、面板未开时整段重试按键。
