## Added

- 路由级判据补齐 `/api/logs` 族最后两条漏网的（`src/app/api/logs/list/route.test.ts` 新建、`history/route.test.ts` 补一格，ISSUE #4215）：`list` 钉「鉴权闸返回 null ⇒ 401 且不读日志」与列表契约（递归列 .log / 排除 dev-launcher.log / mtime 倒序 / 目录不存在回空）；`history` 把原来恒放行的鉴权桩改成可翻面并补同一条 401 防御分支，#4252 的尾部窗口用例原样保留。
- **口径澄清（回应 issue 内评论「应用本身不要求登录，还要钉 401 吗」）**：这个 401 **不是**「应用要求登录」——#3827 起应用无需登录，`requireRequestUser()` 真实实现在无会话时回落演示用户、从不返回 null。用例是把闸 mock 成 null 造出的**防御分支**：万一闸将来真返回 null（重新引入 loginRequired / 回落逻辑改坏），路由必须挡在最前面回 401、不往下读日志。同族 current / sessions / app-runtime / diagnostics 的 401 用例都是这个口径（#4051）。
- 测试隔离：`list` 在 import 路由前 chdir 到本用例临时目录（路由的 LOG_DIR 是模块加载时的 cwd 常量），afterAll 恢复；与项目里 app-port / setting-backup 的 chdir 先例同款。`history` 仍用 log/ 下带 pid 的临时文件、跑完即删。
