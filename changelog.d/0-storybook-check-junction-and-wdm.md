## Fixed

- **Storybook 落地时自带的两条红**（台账 E13；`tests/storybook-check-script.test.ts` 7 条 + 依赖审计 1 条 high）。都不是业务错，也都不该由「在 Windows 上跑不了」这个事实悄悄消失：
  - **夹具在普通权限下必 `EPERM`**：`symlinkSync(<仓库>/node_modules, <临时目录>/node_modules, "dir")` 在 Windows 上需要开发者模式或管理员令牌，实测七条用例**全部死在搭夹具那一步**（门禁本体完全能跑）。本仓另外两个测试文件早就各自处理过这件事（`tests/check-reformat-only.test.ts` 的 `symlinkSafe`、`tests/dist-artifact-hygiene.test.ts` 的 `symlinkDir`）—— 于是同一个理由被抄了三遍，而第三份就是这次红的这条。收成一处 `tests/helpers/symlink-dir.ts`（Windows 走 NTFS 的 junction，不需要特权且不跨机跨卷；POSIX 忽略 type 参数、行为不变），三处一起改吃它。
  - **`webpack-dev-middleware` 的 high 路径穿越（advisory #1240027，`publicPath` 不以 `/` 结尾时）** 由 `@storybook/nextjs > @storybook/builder-webpack5` 传递带进来，而 Storybook 10.6.1 把自己的 range 钉在 6.x。按 audit 判据给的出路走 ①（override 到修复版 `7.4.5`）而不是 ②（登记进基线 —— 那是棘轮的后门）。这是 `overrides` 块里唯一一条**跨 major**，代价面只有组件工作台的 dev server（本地预览、不对外提供服务）；验证的是这条依赖真正干活的那一面，不只是「装得上」：
    `pnpm storybook:build` 成功产出 `storybook-static/`；`pnpm storybook` 起 dev server 后
    `/`、`/iframe.html`、`/index.json` 三个都是 200（后两个正是由 `webpack-dev-middleware`
    从内存文件系统里 serve 出来的），日志里 `[webpack-dev-middleware] wait until bundle finished`
    也在 —— 收摊走 `node scripts/reap-process.mjs <pid>` 杀整棵树（硬规则 3），端口已无监听。
    `pnpm why webpack-dev-middleware` 确认现在只剩 7.4.5 一个版本。

## Tests

- `tests/storybook-check-script.test.ts` / `tests/check-reformat-only.test.ts` / `tests/dist-artifact-hygiene.test.ts`：三份「为什么要分平台」的注释与实现并成一份（判据的一部分写在判据旁边，抄三遍迟早有一遍被改回 `"dir"` 而没人知道为什么）。三个文件合计 53 条用例，在普通权限的 Windows 上全绿。
