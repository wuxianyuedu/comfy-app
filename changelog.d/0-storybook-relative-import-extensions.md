## Fixed

修复 `pnpm storybook` / `tools\start\storybook.ps1` 启动组件工作台时必刷的告警：`.storybook/main.ts` 与 `.storybook/app-origin-reader.ts` 里的相对 import 没写文件后缀，Storybook 10 的 Node ESM loader 每加载一个文件就打一条 `One or more extensionless imports detected` deprecation（实测一次启动 3 条）。

`.storybook/**` 的相对 import 一律补成 `./x.ts` / `./x.tsx`。能跑但吵的告警更坏处是遮蔽：真正的启动报错混在里面，而这条 deprecation 在下个 Storybook 大版本会变成硬错误。补全后缀在两侧都合法（Node loader 原样放行，webpack 两种写法都解析得到）。

判据落在 `tests/storybook-config.test.ts`：用 Storybook 自己的 `addExtensionsToRelativeImports` 点一遍 `.storybook/**`，它「要改写源码」就等价于「启动会打那条 deprecation」，并配一条反证证明该判据不是空转。
