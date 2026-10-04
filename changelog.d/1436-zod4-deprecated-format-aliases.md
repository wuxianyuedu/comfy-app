## Changed

- **`z.string().url()` → 顶层 `z.url()`（zod 4 的 `@deprecated` 别名收口）**：
  `zod@4.6.5` 把一批 format 方法降级成 `@deprecated` 别名（类型声明里逐条写着
  `/** @deprecated Use z.url() instead. */`），而**编译器不报**——它们仍能跑、类型也对，
  于是「升级后该改没改」全靠人记得去读上游的 d.ts。本批按上游声明的口径扫了一遍，
  命中 4 处代码点：
  - `src/lib/core/config.ts` 的 `comfyuiBaseUrl`（env 校验）
  - `src/server/api/routers/setting.ts` 的 `comfyEmbeddable`（`base` / `hostOrigin` 两个入参）
  - `src/server/api/routers/setting.ts` 的 `openExternal`（请求方给的任意地址那道闸门）

  连带把 7 份文件里 9 处**引用旧写法**的注释一并改成 `z.url()`（注释里写的应当是
  当前实现，否则下一个人 grep 会以为还在用废弃形态）。`.refine()` 链在 `ZodURL` 上
  照常可用，行为零变化；`tsc --noEmit` 与四个相关用例文件（106 条）全绿。

- **规范里那句「zod 4 移除 `z.string().url()`」是错的**（`docs/standards/Comfy-APP-T3-项目开发规范.md`）：
  实测**没有移除**，是**保留为 deprecated 别名**——这正是本仓这 4 处一直没变红的原因。
  按「移除」去理解的人会得出「既然还在用就是漏改」的错误结论，也推不出「要靠上游
  `@deprecated` 注释主动扫」这个动作。改写成当前事实 + 替代写法（顶层 `z.url()` /
  `z.email()` / `z.uuid()`）+ 为什么编译器帮不上忙。
