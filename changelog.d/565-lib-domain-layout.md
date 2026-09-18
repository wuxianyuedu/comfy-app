## Changed

- `src/lib` 根目录的 62 个模块归入 6 个新子域，根目录只剩 21 个「顶层单例」：
  `workflow/`（工作流结构 / 参数 / 运行时状态，11 个 `workflow-*`）、
  `log/`（日志路径、面板文本解析、会话区间、运行时镜像）、
  `comfy/`（主 ComfyUI 之外的旁路进程与客户端）、
  `shell/`（桌面壳 / 开发服务器 / 更新 / 陈旧代码 / 追踪忽略）、
  `media/`（媒体类型、尺寸预设、素材、上传）、
  `process/`（进程启动的共用原语）。
  此前同一件事的模块散在两处（`size-presets.ts` / `size-preset-store.ts` 相隔 20 个
  文件名、`log-paths.ts` 与 `log-ansi.ts` 同族却不相邻），查找只能靠 grep。
  `git mv` 72 个文件、148 个文件改 import，**行为零变化**。

## Added

- 门禁 **R13′/R14**（`scripts/check-file-structure.cjs`）：`src/lib` 根目录只放
  `DOMAIN_EXEMPT` 登记的顶层单例，其余模块必须有子域目录；子域目录名必须在
  `DOMAINS` 里登记 —— 未登记即阻断，让「新增域」同时带上按实测值设的覆盖率门槛
  （规范 §12.5.3 / §18.14）。回归测试 `tests/check-file-structure.test.ts` +4 例。
- 新增 `comfy/` 子域，收留此前平铺在根目录的旁路模块 `comfy-embed`、
  `comfy-readiness-client`、`comfy-stats-client`、`comfy-tab-client`
  （主执行链 `comfyui/` 保持原样，不受影响）。
