## Fixed

- **`tests/gate-hint-targets-exist.test.ts` 把「仓库路径」与「产物根路径」当成同一个命名空间，
  于是常年拦人**：产物层门禁 `scripts/check-standalone-contents.cjs` 的
  `REQUIRED_HOST_FILES` 里那两条 `scripts/executor-host.runtime.mjs` /
  `scripts/executor-host.build.json` 是**构建期由 `scripts/build-executor-host.mjs` 写进产物**
  的文件（P3 §5 Phase 3-E1 / ISSUE #1169，随 #1219 进 master），仓库里永远没有 —— 判据问的
  是「仓库里有没有」，它答的是「产物里有没有」。全量 `pnpm test` 实测 **1 败 460 过**，
  隔离串行重跑同样红（不是并发脆弱）。
  拦人的面比看起来大：本判据的锚点脚本 `check-theme-colors` / `check-ui-primitives` /
  `check-dead-exports` / `check-file-structure` 任一被改动，增量测试层就会把这份文件拉进
  C 组，于是**碰这四份门禁脚本的人都会被一条与自己无关的红挡住**（§13.5.8 的按路径引用判据）。
- **放行按三元组精确配对，不放命名空间**：新增 `PRODUCT_ROOT_LITERALS`，每条登记
  「写这条字面量的门禁脚本 + 字面量本身 + 构建期生成它的脚本」，三者都对上才跳过仓库存在性
  检查。**没有**采用「`scripts/` 开头一律放行」或「整份脚本豁免」—— 本判据要抓的正是
  「把要豁免的源码路径抄错」这类错（文件头动因那次就是这么静默失效的），而抄错的路径同样
  长得像产物路径，放开一个前缀就等于把洞开在判据最需要的地方。
- **例外表自己配了一条复算用例**（`it()` 3 → 4）：三条登记理由逐一验回 —— ① 登记方脚本里
  这个字面量还在（不在了 = 空账，该删）；② 生成方脚本逐字写着这个文件名（不写了 = 理由失效）；
  ③ 仓库里仍然没有这个文件（哪天入库了 = 该回到被正常管着的状态）。没有这条，例外表就是
  一张「加进去再没人检查」的清单，正是本文件动因批评的形态。

## 归属

- 红由 ISSUE #1169 那条线（#1219）带入 master，本轮在 `fix/gate-hint-product-path-exemption`
  分支单独收；**没有改动那条线的任何代码或判据**（`build-executor-host.mjs` /
  `check-standalone-contents.cjs` 的 `REQUIRED_HOST_FILES` 清单原样保留），改的是本判据的
  命名空间口径。
- **它是 #1220 之后那次全量复跑才被看见的**：`pnpm build` 的收尾链不跑这份判据，
  而 #1219 自己那次提交也没碰本判据的四个锚点，所以增量测试层没把它拉进 C 组 ——
  这条红在 master 上静置了一段。看见的渠道（全量）本来就是它该被看见的地方，
  不是新增的例外。
