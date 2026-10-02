## Fixed

- **启动页「查看日志」往上翻看早期编排输出时，每隔 1.5 秒就被拽回最新一行**（ISSUE #1290 用户反馈）：面板每 1.5s 轮询一次 `get_launch_log`，而 `renderLog` 在刷新时**无条件**把滚动位置设到底部（`logPanel.scrollTop = logPanel.scrollHeight`）—— 少了「用户有没有接管滚动」这一条判据，正在读的那几行每次轮询都被抽走，也框不中要复制的内容。修法与全库其余日志面板同源（`src/components/ui/use-scroll-follow.ts` 的 `NEAR_BOTTOM_PX = 32`）：距底 32px 内（含几何量不到，如首帧 / 面板收起）才算仍在跟随、刷新照旧贴底；用户上翻超过阈值后刷新**一个像素都不动**他的位置，并在面板右下角浮出「↓ 回到最新」—— 「不自动滚」不等于「有新内容也不吭声」（硬规则 4 的可见出口，与设置页运行日志的「恢复自动滚动」同一口径）。重新打开面板或自己滚回底部即恢复跟随。

  顺带把日志面板拆成「外层定位上下文 + 内层滚动容器」两层：绝对定位的按钮若挂在滚动容器里会随日志内容一起滚走，而右下角是它唯一有用的位置。

  这条此前没有任何判据看着：启动页是**编译期内嵌的独立页面**（源 `public/splash.html`，副本 `src-tauri/splash-assets/{splash,index}.html`），既不在 `src/**` 的 P21 硬闸（「视图里自写滚动贴底」）扫描面里，也没有用例跑过它的脚本。新增回归用例 `tests/splash-log-scroll-follow.test.ts`：在 jsdom 里**真跑那段内联 `<script>`**（不是拿正则凑源码形态）、量出贴底几何后逐条钉住「跟着滚 / 上翻不动 / 可见出口 / 滚回底部恢复 / 32px 阈值内不掉出跟随 / 同内容不碰位置」六条，反向验证改回无条件贴底即红。

  改的是 `public/splash.html`（源）与两份副本，**必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`。规范见 07 §7.18.6 与 launch-and-build §5 对照表。
