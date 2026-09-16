## Changed

- **`cn()` 的合并引擎从 `clsx` + `tailwind-merge` 换成 shadcn 官方的 `cn@0.3.0`**：
  `src/lib/utils.ts` 缩成一行 `export { cn } from "cn"`，两个旧依赖从 `package.json`
  与锁文件移除。调用方一行都不用改（`~/lib/utils` 的 `cn` 导出名与签名不变），
  客户端产物里的合并实现整体换掉：旧的 `clsx` 递归 join + `tailwind-merge` 默认配置
  已不在任何 chunk 中，取而代之的是表驱动的 `cn` 引擎。新包自带 `twMerge` / `twJoin` /
  `clsx` 同名导出与 `cn/config` 的自定义主题入口，但本仓库用的是默认配置，因此只引
  默认出口。
