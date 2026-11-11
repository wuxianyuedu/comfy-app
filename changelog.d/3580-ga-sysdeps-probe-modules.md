## Fixed

- **壳门禁那把 Linux 系统库探针问错了 `pkg-config` 模块名，GA 上对任何碰壳的 PR 恒红**（#3580）：
  #3572 把「平台前提归 workflow 装、判据只说人话」这层分工补上之后，PR #3567 在 GA 侧
  **仍判红**，红的那一格还是「桌面壳（改了 src-tauri 才跑）」，判据输出是
  `缺 Tauri 在 Linux 上编译要的系统库（ayatana-appindicator3-0.1 / rsvg-2.0 / xdo /
  openssl）`；而 GA 日志里 apt 那一段**成功**（`Setting up librsvg2-dev` /
  `Setting up libxdo-dev` 都在），探针 22 秒后才跑 ⇒ **不是安装失败，是探针问错了模块名**。
  根因是探针名单照着「Tauri 官方 Prerequisites 的库清单」写的，而**编译期真正会被
  pkg-config 问到的模块**是另一批 —— 那四个**注定永远报缺**：`rsvg-2.0` 名字就错（发行版
  实名 `librsvg-2.0`）且依赖图里无人链接 rsvg；`xdo` 不在依赖图（`muda` 的 `libxdo` 是
  可选 feature，而 `tauri` 依赖 `muda` 时写死 `default-features = false` 且只要 `serde` /
  `gtk3`）且发行版不提供任何 `.pc`；`ayatana-appindicator3-0.1` 是 `libappindicator-sys`
  **运行期** `dlopen`（它没有 build.rs）；`openssl` 不参与编译（依赖图里只有 `rustls`）。
  处置：探针名单换成**穷尽扫描**出来的 15 个 `.pc`（Linux 目标依赖图 334 个包、其中 69 个
  带 `build.rs`，逐个读 build.rs ⇒ 17 个碰 pkg-config，编译期硬失败的是那 15 个；另有四处
  软失败不进名单），并另立「**模块 → 提供它的 `-dev` 包**」映射表 —— 缺前提时的出口从
  「一句笼统的装官方清单」改成「缺哪个点哪个包 + 一条可复制的 apt 命令」；workflow 的 apt
  清单与那张表一一对应（`tauriLinuxAptPackages()` 是唯一出处），去掉 `librsvg2-dev` /
  `libxdo-dev` / `libssl-dev`，`libayatana-appindicator3-dev` 标注为**运行期**托盘后端。
  ⚠️ 顺带钉住一条容易混的事：**「平台前提装齐了」不等于「探针问对了」** ——
  `libwebkit2gtk-4.1-dev` 的 apt 依赖闭包（395 个包）其实**已经把那 15 个 `.pc` 的提供包
  全带进来**（含 `libdbus-1-dev`）⇒ GA runner 上并不缺任何库，红的**只**是探针名单。
  判决链、GA 结论回读、三态退码与 CNB 侧台账一字未动。
