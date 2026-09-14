## Changed

- **README 的 Linux 快速上手补上「启动 dev server」这一步，并订正 `pnpm dev` 的端口说明（ISSUE #489）**。原文「`pnpm dev` … 访问 http://localhost:3100」与规范 §1.1 的端口契约不符：`3100` 只是**路径推导不可用时的兜底值**，正常链路上 `pnpm dev` 经 `scripts/dev.mjs` 解析出的是 `.env` 的 `COMFYAPP_PORT` → **按检出路径推导的 3200~3999**（实测本工作区为 3311），且 `tauri.conf.json` 的静态 `devUrl: 3100` 属启动器链路、不参与 `pnpm dev`。按旧文档在浏览器打开 3100 会得到 ERR_CONNECTION_REFUSED，看起来像「Linux 跑不起来」。同时快速上手的步骤从「3 步」补齐为「5 步」——原先 `pnpm db:push` 之后直接跳到「注册 comfyapp:// 协议（仅 Windows）」，**没有任何一步告诉 Linux 用户怎么把服务起起来**，只读快速上手的人拿不到 `pnpm dev` 这条入口。
