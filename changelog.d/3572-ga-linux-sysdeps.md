## Fixed

- **GA 侧那一格在 Linux 上编 Tauri 缺系统库：判红的是环境前提，不是 Rust 侧代码**（#3572）：
  PR #3567 在 GA 侧判红，红的是「重档静态判据」里那一格「桌面壳（改了 src-tauri 才跑）」，
  退出码 **101** —— 那是 cargo 的**编译期**失败（`glib-sys` 找不到 `glib-2.0` 的 `.pc`），
  与「Rust 侧改坏了 / 单测红了」**同一个退码**，读的人只能靠日志里那行
  `pkg-config … was not found` 分出真因。根因三段事实凑齐才成立：①
  `pr-gate.yml` 六个 job 全部 `runs-on: ubuntu-24.04`，而 ubuntu runner 只预装
  `pkg-config`、不预装 Tauri v2 编译期要的那批系统库；② 承重门禁是 #3064（2026-11-02）
  从 CNB 自托管节点（**Windows**，走 MSVC + WebView2，不需要 glib/webkit）迁到 GA 的，
  迁移后 master 上**没有一笔提交**碰过 `src-tauri/src/`（立案时的读数：连续 418 笔）⇒
  这一格在 GA 上**从来没真跑过 `cargo test`**，#3562 是第一次；③ 仓库里没有任何一层准备
  这层系统库（`.github/workflows/**` 与 `.cnb.yml` 全文检索 `apt-get` / `webkit2gtk` /
  `libgtk` / `appindicator` / `librsvg` 零命中）。处置分两半、边界不越：**平台前提归
  workflow 那一层**（`pr-gate.yml` 的 `heavy-gates` job 在跑重档之前装 Tauri 官方
  Prerequisites 的 Debian/Ubuntu 一栏那批 dev 包，清单照抄官方不自造）；**判据只说人话、
  不自己装**（`shell-gate` 在跑 `cargo test` 之前用 `pkg-config --exists` 探一遍 ——
  与编译期同一把尺，探得过就是编得过 —— 缺哪个点哪个并给出安装出口；判据 `sudo` 改本机
  是错的边界，提交一次就被 sudo 改一次机器）。缺前提时归因是独立的一格「cargo test 没跑
  起来：缺哪几个系统库」，**不与「cargo test 失败」混**（后者是「Rust 侧真坏了」）——
  说混了会让读的人去修一条根本没执行过的判据。那一档**退 1** 而不是退 2：平台侧最终
  都是红，而退 2 会被聚合层归进「没跑起来」那一档、**只打印标签不打印判据的输出** ⇒
  真正的原因会整段消失。判决链、GA 结论回读、三态退码与 CNB 侧台账一字未动。
