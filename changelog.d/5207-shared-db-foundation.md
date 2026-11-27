## Added

- 多检出共享协作地基（#5207）：`generatedRoot()` 支持 `COMFYAPP_GENERATED_ROOT` 覆盖（绝对路径 /
  相对 cwd / 空串回落），Windows `comfyapp-open-folder.ps1` 同步覆盖，跨语言成对判据保持；
  桌包入口 `standalone-runtime.mjs` 改为走 `planExecutorHostSpawn()`，UI-only 检出设
  `COMFYAPP_SKIP_EXECUTOR_HOST=1` 后不再多拉一个宿主。新增多检出操作指南（共享 DB / 心跳 /
  产物根的确切配置与故障读数）并在产品总览登记拓扑。同批补产物根覆盖与启动点用例。
