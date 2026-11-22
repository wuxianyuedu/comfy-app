## Fixed

- **修正服务状态行形状判据用例在纯 master 上的假红**（#4785）：`service-status-row.test.tsx`
  里「三行都用状态行容器」仍按旧布局数 `STATUS_ROW_CLASS` 期望 3 处，而 #4710 已把
  ComfyUI 页改成纵向三行、移除了该容器类，实测只有 2 处（设置页 Ollama / Drizzle
  Studio 两行）。判据改为核对「设置页两行用容器 + ComfyUI 页是纵向布局且不再用该容器」，
  同批补上钉住 #4710 布局决策的防回归断言 —— 视图退回旧布局或再漏改判据都会红。
