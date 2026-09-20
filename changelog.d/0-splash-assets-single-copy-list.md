## Fixed

- **`dev-launcher.mjs` 同步启动页时漏了 `index.html`，入库副本因此长期漂移**：
  `src-tauri/splash-assets/`（`tauri.conf.json` 的 `frontendDist`，编译期被嵌进 exe）
  下要放**两个文件名**的副本 —— `splash.html`（窗口配置显式引用的）与 `index.html`
  （直接访问根路径时的兜底），内容同源于 `public/splash.html`。这两个名字此前在四处
  各写了一遍（`src-tauri/build.rs`、`scripts/dev-launcher.mjs`、`scripts/build-desktop.mjs`、
  `tools/scripts/build-tauri-release.ps1`），而 `dev-launcher.mjs` 那份**只写了
  `splash.html`** —— 于是每次启动把一份刷成最新、另一份留在旧版：任何一次
  `cargo build`（`build.rs` 在编译期把两份都刷新）之后，工作区里就多出一个
  「被修改」的**入库**文件，`tests/check-file-structure.test.ts` 的「三份启动页副本
  一致」当场变红（该用例此前一直是红的）。

  修法不是「在漏的那处补一行」（那只是把同一个失误推到下一次新增加载方式时），而是
  把「副本有哪几份」收成一处定义：新增
  `scripts/launcher-core/splash-assets.mjs`（`SPLASH_ASSET_NAMES` 是副本名的唯一定义、
  `syncSplashAssets()` 是同步的唯一实现），`dev-launcher.mjs` 的 `ensureSplashResource()`
  与 `build-desktop.mjs` 都改为调它 —— 启动编排层从此**不再知道副本叫什么名字**。
  回归护栏见 `tests/splash-assets-sync.test.ts`（含「两个调用方都经共享实现」与
  「dev-launcher 里不得再出现副本名字面量」两条源码级判据）。

- **同步改为「内容没变就不写盘」**（判据与 `build.rs` 的同名步骤一致）：写盘会推进
  mtime，而 `dev-launcher.mjs` 的壳时效判据（`shellStaleWarning`）比的正是该目录下的
  最新 mtime —— 每次启动无脑刷一遍，会让「正在运行旧版桌面壳，建议重编」的提醒
  **每次都报**，真正的源码改动反而被这层噪声盖掉。

## Changed

- 回填入库的 `src-tauri/splash-assets/index.html`（把上面那条漂移修平）：三份副本
  现在逐字一致，「三份启动页副本一致」用例由红转绿。
- 规范 `docs/standards/07-日志系统.md` 的启动页条目补一条：副本名清单只定义一处。
