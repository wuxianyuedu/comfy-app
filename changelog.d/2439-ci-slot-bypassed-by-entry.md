## Fixed

- CI 缓存槽恢复接管（#2439）：#2286 在 `ci-install-deps.mjs` 入口层把 `main` 的
  `install` 依赖覆盖成裸 `runInstall`，槽闸整个被旁路 —— `.cnb.yml` 的
  `COMFY_CI_SLOT: "1"` 还置着、`applySlot` 却一次都不被问，PR 每格退回全量安装
  （此前槽命中形态 5～20s）。改为把 pnpm 探测事实**传进** `runInstallWithSlot`
  的 `install` 依赖，三种槽出口话术随之回到日志；补一条源码形状判据钉住
  「入口层不许绕过槽闸」。
