## Changed

桌面壳六处手写 sleep 轮询循环收敛成一处 `poll_clock::PollClock`（audit §C.4 L5，
ISSUE #2192）：重导航（2s×90）、端口等待（500ms×240）、首绘看护（250ms×480，
改两段退避 250ms×40→500ms，预算 120s 不变）、启动页基准捕获（100ms×50）、
漂移看护（1s×300）、POSIX focus waiter（常驻 `forever`，等的是进程内标记）。

- 每拍 **tick 在循环体最前**：首绘看护那次「`continue` 跳过循环底 sleep、480 次探测
  微秒内烧完」的事故从结构上消失；守它的 `#[test]` 同批改钉新不变量
  （拍在那一支之前 + 那一支内不许再塞裸 sleep）。
- 预算全部改**墙钟**（`Instant`），退避不缩短它 —— 与 Node 侧 `ready-wait.mjs` 同一句语义。
- 两处裸 `sleep` 有意保留：150s 一次性安全网（不是轮询）、端口就绪后的 500ms 沉降等待
  （已注明不是拍）。

随本笔同批修掉「壳门禁在平台上跑不起来」的两半（`cargo test` 唯一执行者的出勤前提）：

- **服务账号会话够不着工具链**：runner 的 PATH 与 `~/.cargo` 都到不了开发者会话的
  rustup（`CARGO_HOME` 是用户级变量）—— 重档 stage 显式带 `CARGO_HOME` / `RUSTUP_HOME`
  （缺 RUSTUP_HOME 时 rustup 代理实测 `could not create home directory … 拒绝访问`）。
- **fresh clone 缺编译前提**：build script 校验 `binaries/node-<triple>` 与 `static/`
  存在，而真产物被 gitignore ⇒ shell-gate 在 cargo test 前落位**编译前提**
  （sidecar 复制当前 node、static 建占位；真产物仍归 build-desktop，两路不冒充）。
  sidecar 命名判据随本笔抽到 `scripts/sidecar-name.mjs`（build-desktop 与 shell-gate
  同源；build-desktop 无模块守卫、import 即执行，不抽叶子引不进来）。

