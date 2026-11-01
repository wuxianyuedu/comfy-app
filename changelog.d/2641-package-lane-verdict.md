## Changed

- **发布档的触发与「三平台」现状落档（ISSUE #2641）**：设计里「`tag: v*` 触发、三平台
  （ubuntu / windows / macOS）打包，20–40min」写的是**前瞻**，不在仓内任何配置落地（没有 `tag`
  事件键，只有 `pull_request` / `push` / `crontab` / `web_trigger_package`）。今天发布档只有
  `crontab: 0 2 * * *` 定时 + `web_trigger_package` 手点两条触发口、且**只打 Windows 桌包**
  （单台自托管 Windows 节点，macOS / Linux 无构建节点与签名凭据）。维持现状，把「三平台」明确
  标成未立项前瞻，复评触发写进 launch-and-build §7.7（第二个非 Windows 节点 / 真实 macOS 分发
  需求 / CNB 平台侧确认支持 `tag` 事件）。
