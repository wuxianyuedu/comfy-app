## Changed

- **模式契约不再随包分发**：内置默认回到源码里（`model-mode-contract.ts` 的
  `configuredModeContracts`，编译进构建产物），机器上的改动是**本机覆盖**
  （`data/workshop-mode-contracts.json`）。上一版把注册表放在入库的 `config/` 目录并显式
  随包分发（`build-desktop.mjs` 的 `§入库配置` + `check-standalone-contents.cjs` 的
  `REQUIRED_CONFIG_FILES`），代价是「要改默认就得去改那个 JSON」，且桌包里读到的与检出里
  的并不总是同一份。现在：改默认口径 = 改代码 + 提 PR（走评审、有 diff）；只想在本机试
  = 编辑器保存即可，不污染别人的检出。编辑器保存提示不再报出文件名（那是个会随部署形态
  变的东西），改说「改动只落在这台机器上，不会跟着代码走」。两层产物白名单与装配断言同批
  去掉 `config`（不存在了就不该放行它）。
