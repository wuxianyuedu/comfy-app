## Fixed

- **工作流库偶发「界面里一个工作流都没有」（左列空、「共 0 个工作流」）**，三处成因一起修：
  - 本地工作流目录只认 `<ComfyUI 路径>/workflows` 与 `<ComfyUI 路径>/ComfyUI/workflows`，认不出桌面版实际使用的 `<ComfyUI 路径>/ComfyUI/user/default/workflows` —— 配好了 ComfyUI 安装路径也可能一个根都推导不出来（推导失败时**不报错、不提示**，直接当「没有工作流」）。现在按 `user/default/workflows` → `workflows` 的顺序推导。
  - 本地目录扫描不递归，而 ComfyUI 自己的 `workflows/`、桌面版的 `user/default/workflows/` 都会分子目录（`default/`、`image/`…），放在子目录里的工作流一个都不显示。现在按扫描器自身文档的意图递归扫描。
  - 空列表不再只有一句「还没有工作流」：没解析到本地目录 / 目录不可访问 / 目录里没有工作流文件这三种情况，空态直接给出原因与解析到的路径；服务端在空结果时也会落一条 warn（含 userId、根目录状态、扫到文件数），便于事后对账「这次为什么是空」。
