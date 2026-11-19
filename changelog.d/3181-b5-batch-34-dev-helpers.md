## Changed

- **oxlint B5 清账子批34**（ISSUE #3181 的总账批次之一）：`tests/dev-*` 4 份与
  `tests/helpers/` 11 份从 `typescript/no-unsafe-type-assertion` 的文件级豁免里摘除，
  27 处存量就地修掉（`JSON.parse` / CJS 模块 / require 来的插件改形状守卫；catch 改
  字段读取；`(x as Error).message` 改 `instanceof Error` 收窄；故意喂错型 / 库类型
  说谎的四处改为**行级豁免 + 理由**）。判决面 `oxlint.parity.config.mjs` 同批删行；
  台账 15 行改「已清」。**B5 至此仅余 `tests/oxlint-jsplugin-rules.test.ts` 1 份**
  —— 它带着 #3440 的在途改动，等那一笔落地后同批摘除豁免。
  `pnpm run lint` 0 诊断、`tsc --noEmit` 绿、相关用例绿。

  Refs #3181
