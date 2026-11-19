## Changed

- **#3575「评估一下，前后端启动是否应该分开」**（`docs/audits/2026-11-13-frontend-backend-startup-evaluation.md`）：
  结论 **不该分开**。现状拓扑（编排器 → 前置格 → schema 同步（后台子进程、指纹跳过）→
  `next dev`（UI+API 同进程）→ ComfyUI 用时才拉起）逐项检验了拆分理由（启动速度 / 故障隔离 /
  独立部署 / 独立扩容 / HMR / 权限面 / CI 复杂度），并把真正值得拆的那格点名：ComfyUI
  执行编排迁出 Next 进程的 **`executor-host` 灰度**（`COMFY_EXECUTOR=host`，dev 与桌包
  两条链路都拉得起，默认 inline）。转默认的前置清单写在文中；本笔不改任何运行行为。
  附「作罢清单」（API 独立服务 / dev:web 双入口 / schema 同步挪进请求路径 / MCP 并入 Next）。
