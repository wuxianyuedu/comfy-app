## Changed

- **`experimental.turbopackPluginRuntimeStrategy` 换成 `"workerThreads"`**（issue #2542 的
  第一格）。Next 16.4.3 的默认是 `childProcesses`：Turbopack 的插件作业各起一个真子进程，
  Windows 上进程冷启最贵；换 worker 线程省掉进程冷启与 IPC 序列化。本仓真机实测
  （同一台机器，冷=清 `.next` 后跑、暖=紧接着原样再跑，各一次）：
  - `next build` 冷：**88s → 43s（−51%）**
  - `next build` 暖：**83s → 36s（−57%）**
- 同一单里另外几格的口径：`turbopackRustReactCompiler` 记档跳过（本仓 `next.config.js`
  零 `reactCompiler` 命中，没有启用对象）；`turbopackGc`、`turbopackLazyDynamicImports`
  按同一套冷/暖读数逐格验证，不达标即回退。
