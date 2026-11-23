## Changed

- 首页不再重定向拼接 `/workspace`（#4881）：访问 `/` 地址停在根路径、直接渲染创作台（复用 workspace 页面实现，单份代码）；`/workspace` 路由原样保留，外链与书签不失效。
