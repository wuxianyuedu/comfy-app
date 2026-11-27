## Added
- `pnpm ship --find-issues <关键词> [--state open|closed|all] [--label <标签>]`（#5167）：开工前查重单此前在 CI 立案脚本、评论守卫与人工核验里各写一套 `list-issues` 分页与形状解析，失败形态不统一；平台说还有却给空页会被读成「没有」。现在复用 `cnbJson` / `readListHasMore` 的取数窗口，输出 `号 · 状态 · 标题 · 标签 · URL` 与翻页覆盖，取不满退 2 并明说「没取到」，取满且无命中才说「确实没查到」；与 ship 其它单件动作互斥，一次只查一件事。补 8 条形状 / 退码用例。
