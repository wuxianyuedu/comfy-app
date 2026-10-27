## Added

`tests/workflow-param-map-wire-contract.test.ts` —— 台账 E4 的第七格：`paramMap` 那一列的
**写边界 ⇄ 读边界同读数**判据（ISSUE #2171 的第二档）。

此前的形状是「两侧各有各的单测、谁都不判对方」：`src/lib/workflow/workflow-param-map.test.ts`
一组判读边界（`workflowParamMapSchema` / `parseWorkflowParamMap`）收窄到哪儿为止，另一组判
写边界（`workflowParamMapInputSchema`）原样透传 —— 而「一枚作者画好的合法条目，过完入参判据、
再过读边界，字段是不是还是那一套」从来没有执行者。那条通路坏了的表现是运行期拿不到参数覆盖值，
而界面照样显示「已配置」。

形状照同族第五格（#2160 的远端模型条目）：判**两半** —— 合法条目两侧同读数（含一枚历史命名空间
的键，两侧都不许剥），以及**该不同的那一半**（库里存着一行脏值时写侧原样透传、读侧整列折 `null`）；
两侧哪天并成一份判据，这两行里必有一行站不住。

同批在 `docs/guides/PRODUCTION-GAPS.md` 的 E4 那一行记下第一档的**现场改动面**：把
`Character` / `CharacterPortrait` / `Shot` 三份接口换成 `z.output<typeof …>` 之后 `tsc` 报
**25 处错、散在 17 份文件**，而根因不是字段清单不一致，是两侧对「谁可选」编码不同
（`characterInputSchema` 的外层 `.transform` 无条件写 `portraits:` 那个键）。所以那一刀得
先对齐 schema 侧的可选性再换派生 —— 这一轮没有改 `src`，测量结果写进台账，并按 §13.10.9
「一条诉求一张单」在关本单之前拆出 **ISSUE #2499**（P2）承接那一刀，免得它随 #2171 一起
关掉而失去可见性。
