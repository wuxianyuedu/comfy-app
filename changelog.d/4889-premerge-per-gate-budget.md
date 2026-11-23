## Fixed
- pre-push 合并前复算的单格 600s 预算写死、抬整体预算救不了 601s 的 eslint（#4889）：`runGateStep` 的缺省预算现在取 `COMFY_PREMERGE_TIMEOUT_MS` 的显式值（恒 ≤ 整体预算；未设 / 非法回 600s，非法仍由复算入口退 2 并点名），48 条判据不再被单格 600s 砍成「没跑起来」。预算解析唯一实现收在 `scripts/launcher-core/shell.mjs`，回归用例钉住「抬整体预算时单格同步抬」，同步更新 §13.5.17 那条出口说明。
