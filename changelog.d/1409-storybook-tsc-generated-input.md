## Fixed

- **没跑过 `pnpm storybook` 的检出，提交门槛的 A 组（`tsc --noEmit`）恒红**（台账 E15 / ISSUE #1409）：Storybook 注入层要的「应用 origin」由 `scripts/storybook-assets.mjs` 在启动工作台时调权威实现 `scripts/app-port.mjs` 现算（端口按检出路径推导 3200~3999，写死必然错），落一份整目录 gitignore 的生成件；而 `tsconfig.json` 的 include 显式列着 `.storybook` 那两条通配（点目录不在 glob 的默认展开范围里，不列就是 tsc 与 eslint 的双重盲区）。两个各自正确的决定叠起来 = 类型程序去解析一个**只有跑过工作台才存在**的文件 ⇒ 报 TS2307，而报错指向谁都没碰过的文件、拦住的是从那份基线分出去的**每一次**提交。
  **`exclude` 治不了这个病（实测）**：它只过滤 include 的 glob，拦不住「作为 import 目标被拉进程序」的文件（include 那一对 `.storybook` 通配 + exclude `.storybook/generated`，入口里照旧 `import`，缺件照样 TS2307）。所以修法是**让被引方不依赖生成件**：生成件从一份生成的 `.ts` 模块改成一份**纯数据 JSON**，类型与缺省值由入库的 `.storybook/app-origin-defaults.ts` 承担；值由 `.storybook/main.ts`（Storybook 在 **Node** 里加载）读出来、经 `env` 编译期内联进浏览器 bundle，`.storybook/preview.tsx` 侧只解释 `process.env`（`preview` 会被打进浏览器包，webpack 把 `node:fs` 换成 stub —— 在那里读文件必然静默走兜底）。缺了生成件只是一种**常态**：画布上显示缺省端口，与「应用没起时看到降级形态」同一类如实呈现。
- **组 A 失败时的生成物点破扩到工作台的现生成件**（ISSUE #1182 同族）：`scripts/check-tsc-artifact-hint.cjs` 原先只认 `.next/` 一个目录段，`.storybook/generated/` 的报错不会被点破。现在两类各自认得、并给各自的处置命令（删法不同，防复发话术也不同）；仍与源码错混在一起时不点破，免得让人忽略真错。

## Tests

- **`tests/storybook-tsc-input.test.ts` 按新修法重写（条数 4→7，仍在固定清单里）**：① 被引方（注入层 / preview / main）一处都不静态 import 生成件，且注入层确实从入库的那份读类型；② 真跑一次生成器，判产出的 JSON 字段名与类型**逐字段**对齐入库缺省值（改名就是静默回落成缺省端口）；③ 生成物仍然不入库；④ **把生成件挪走、拿真检出复量 tsc 必须退 0**（不靠读配置下结论 —— 那条路实测不管用）；另加一条**反证**：临时目录里搭最小复现，证明「静态 import 一个不存在的模块 + 同时 exclude 它」照样报 TS2307（这条是 ① 与 ④ 的前提，否则两条都是空转）；再加一条不依赖磁盘状态的 reader 判据（缺键 / 半份数据都必须走缺省）。
- **`tests/check-tsc-artifact-hint.test.ts` 补四组**：工作台生成件认得、点破话术不串台、与源码错混着时不点破、只命中生成件时不出现 `.next` 专属的防复发话术。
