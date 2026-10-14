## Fixed

- **断开原因明明已经落盘了，界面上却看不到**（ISSUE #1915）。手验现场：消息中心里「应用服务已断开」那条写着「原因由启动编排在进程结束那一刻写入 `run/app-service-exit.json`，只能在服务恢复后读回——恢复时会作为『应用服务已恢复』记进本中心」，而紧随其后的恢复那条却说「这次断开没有留下结束记录」。用户手里明明有原因（文件就在那儿），界面上却一个字都没有。
  - **根因不是「记录没写」，是读它用的通道选错了**：`GET /api/dev/last-exit` 由**应用服务自己**应答，而它正是「断开」这件事里没了的那一方 —— 服务不在，端点必然不通。于是原先只有一条读法：等它恢复应答之后再问，而恢复那条又常常拿不到（这次断开根本没留下记录 / 记录属于更早的运行）。记录其实早在断开那一刻就落在盘上了（写入排在回收整棵进程树之前）。
  - 修法是补上那条**一直只写在设计说明里、代码从没实现过**的存活通道：壳进程活得好好的（用户看到的就是「窗口还在、页面连不上」），读同一个文件不经过任何应用服务。壳新增命令 `get_app_service_exit`（`shell_launch::read_app_service_exit`，回**文件原文** —— 记录形状与文案只在 `~/lib/shell/app-service-exit` 一处解析，Rust 不重复一份），前端经 `fetchCurrentDisconnectExit` 在**断开那一刻**取回原因。
  - 两条通道的「算不算这一次」判据是**反的**，写混就会把旧结论说成这一次的原因：恢复后读回用 `isPreviousRunExit`（记录说的**不是**当前这份进程才显示）；断开时读回用新的 `isCurrentDisconnectExit`（记录说的**正是**刚刚没了的这一份才显示）。后者的 runId 拿不到时（老启动链路 / 手工 `pnpm dev`）退回**新鲜度**窗口（`RECENT_EXIT_WINDOW_MS`，10 分钟）—— 这份文件是单槽的，「盘上有一份记录」既可能是刚写的、也可能是几天前留下的，只判「文件存在」就是把旧结论当这一次的原因。
  - 非壳环境（浏览器 / dev server）没有这条存活通道，界面维持原样并**说清「这一刻读不到」**（指向恢复那条），**不编一个「未知原因」**出来。
  - 顺带修掉一处次序隐患：`push` 的 `time` 过去一律取 push 时刻，而断开那条要先读原因、push 天然比事件晚一个往返 —— 两条消息的先后就会由「哪个往返先回来」决定，而不是「哪件事先发生」。现在生产方带上**事件时刻**，store 按 `time` 倒序摆放。

## Tests

- `src/lib/shell/app-service-exit.test.ts`：`isCurrentDisconnectExit` 逐分支（runId 相等才算 / 不等不算 / 拿不到 runId 时刚写的算、昨天的不算 / 坏时刻与未来时刻都不可当作「刚刚」）+ `parseAppServiceExitRaw` 坏字面一律回 null。
- `src/lib/shell/app-service-message.test.ts`：断开文案两档 —— 拿不到原因时给时刻 + 影响 + 去哪找（不编「未知原因」），拿得到时**当场**把「为什么 + 这一次具体是什么 + 该做什么」写进断开那条。
- `src/components/message-center/hooks/use-app-service-message-log.test.ts`：壳内断开当场带原因与建议；盘上留的是更早那一次的记录时不拿它当这一次的原因；断开与恢复的次序按**事件时刻**排（用假时钟把两拍分开 —— 同一毫秒下测的是排序稳定性而不是因果）。
- `src-tauri/src/shell_launch.rs`：`read_app_service_exit_returns_raw_text_and_none_when_absent`（回文件原文、逐字相等；没写过 / 项目根为空回 `None` 而不是 `Err`）。
