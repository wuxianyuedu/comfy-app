## Fixed

- **「应用服务已恢复」把没人探测的那一段算成了断开时长**。现场：断开 15:03:05、
  恢复 15:05:54，消息上写着「持续 2 分 49 秒」，看起来像服务真的死了近三分钟 ——
  而窗口内的服务日志每一分钟都照常有输出。根因是探活会因**窗口失焦 / 页面进后台**
  而暂停（`useInterval` 的 `pauseWhenHidden`，桌面壳里还有 `pauseWhenUnfocused`），
  后台被节流时定时器还可能拖到分钟级；**停表期间墙钟照走**，于是「断开 → 恢复」两个
  时刻相减得到的时长里混着一段根本没人问过服务的时间（那段时间服务可能早就恢复了，
  恢复点无从知道）。
- **修法：如实标注，而不是从时长里减掉**。探活那一侧新增纯判据 `probeGapMs`
  （按**发起**时刻算、扣掉本该走的那一拍、clamp ≥0），把「这一拍之前没人在探测」
  的毫秒数（`unprobedMs`）沿事实层递到消息中心；恢复那条在时长**照给**的前提下，
  于停表 ≥10 秒（正常 2 秒一拍的五拍）时另加一行「其中 X 分 Y 秒没有探测……这段时间
  服务是否可达无从得知」。**不减掉**那一段：减掉等于宣称「服务在那一刻已经回来了」，
  而恢复点落在没人观测的哪一刻无从知道。间隔小于阈值不加那行（否则每条恢复消息都
  多一行噪声）。
- **顺带修掉恢复文案里指错的日志路径**：那一条此前指向 `log/current/nextjs/`，而一次
  运行结束时它的输出会被归档进 `log/runs/<时间戳>-<runId>/` —— 出故障的那一次往往已经
  不在 `log/current/` 里了，用户按提示查「还是没有」。现在指向**整包**：在「应用日志」
  面板点「打包诊断」，它把 `log/current/` 与最近几次 `log/runs/` 打进
  `log/exports/diagnostics-<时刻>-<runId>.zip`。

## 刻意没做的事（写清楚，别当成已完成）

- **没有**去「取消探活暂停」来实现第一件事：暂停本身正是排除「关显示器 / 后台节流被
  误报成重启」的手段（见 `use-dev-server-liveness` 文件头），治标会把老误报请回来。
- **没有**动共享轮询内核（`src/lib/poll-timer.ts` / `src/components/ui/use-interval.ts`）：
  暂停判据只有那一份，本轮只在探活消费侧读事实。
- **没有**顺手统一 `app-service-exit.ts` 里 `log/nextjs/`、`log/launcher/`、`log/shell/`
  这几个短路径：那是全仓范围的另一件事（牵连多处夹具与 Rust 侧文案），不在本轮范围。

## 验证

- `src/lib/shell/app-service-message.test.ts`：新增「停表 ≥10 秒标注 / <10 秒不标注 /
  冷启动不标注」三条，并把既有 start 事件断言补上 `unprobedMs`（有意逐条更新，非快照）。
- `src/components/message-center/hooks/use-app-service-message-log.test.ts`：新增「恢复那条
  把停表那一段如实标注出来」的接线用例。
- `src/components/studio/hooks/use-dev-server-liveness.test.ts`：新增 `probeGapMs` 纯函数
  用例（连拍算 0 / 首拍算 0 / 停表=间隔扣一拍 / 时钟回拨不为负）与「进后台暂停、回前台
  补跑、且把停表算成 `unprobedMs`」的接线用例。
