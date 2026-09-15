# tools/registry/ — 团队 shadcn Registry（双击用）

| 入口 | 用途 | 逻辑 |
|---|---|---|
| `start-registry.ps1` | 启动本地 shadcn Registry HTTP 服务，供 `pnpm dlx shadcn add @comfy-app-t3/*` 使用 | `tools/scripts/start-registry.ps1` |

> ⚠️ **入口里的内容目录是硬编码的**：Registry 内容在
> `D:/dev/Comfy-APP-T3/registry`（与本项目仓库分开），换机器 / 换用户时必须
> 同步改逻辑脚本里的路径 —— 端口（`3874`）在
> [reference-facts.md](../../docs/reference-facts.md) 里登记，改动要一起对。
>
> 规范见 [16-shadcn-ui与表单校验.md](../../docs/standards/16-shadcn-ui与表单校验.md)。

**非 Windows 平台**：本入口没有跨平台等价物（它是「本机某个固定目录下的静态服务」，
不是项目逻辑）。需要时直接在终端起一个静态服务器指向该目录即可。
