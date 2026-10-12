## Changed

- **AGENTS.md 把「已经有执行者、规则正文却没点名」的 5 条补上引用**（硬规则 1 / 2 / 3 / 16 / 24）：
  这 5 条此前读起来像「只有文档约束」，而执行者其实一直在跑 —— 属于**文档引用缺口**，
  不是治理缺口，补一句指名即可归零。逐条都是回读原文之后写的，不是照着规则措推测的：
  · 硬规则 1（pnpm-only）→ `scripts/check-doc-references.cjs` 的「台账文档与 `AGENTS.md` 里
  不许出现 `npm run` / `npx` 可执行命令」那一档；覆盖面写明是**文档里的命令口径**、不含源码调用；
  · 硬规则 2（工具链钉死项）→ `tests/turbopack-tracing-excludes.test.ts` 判
  `useTypeScriptCli: false` 与实际解析到的 TS 版本必须配对；
  · 硬规则 3（整树回收）→ `tests/cross-platform-launcher.test.ts` 真起进程树回收、
  `src/lib/process/kill-process-tree.windows.test.ts` 断言 `taskkill` 参数形态；
  · 硬规则 16（加载即读库先判就绪 / 构建期模块纯 ASCII）→ `tests/reaper-side-effect.test.ts`
  判模块零副作用与表就绪守卫，纯 ASCII 那一半由
  `tests/lib-node-only-declarations.test.ts` + `tests/build-fresh-checkout.test.ts` 守；
  · 硬规则 24（复用优先）→ 事后兜底的两条脚本点名：`scripts/check-code-duplication.cjs`
  （§12.12 字面孪生）与 `scripts/check-dead-exports.cjs`（§12.16 零消费导出），此前只引章节号。
- **顺带把「无执行者」那一堆的尺寸说清**：本轮逐条盘 26 条硬规则时，「规则正文没点名执行者」的是
  9 条，其中 5 条就是上面这一批（有判据、没引用），**真查不到执行者的是 4 条**
  （硬规则 4 语义判断、8 已由同批另一份碎片补上判据、9 运行时状态提交期不可见、
  15 原理上不可观测）。剩下 3 条**没有**为它们临时造判据 —— 三条的下一个动作各不相同，
  硬要收成一个数字会误导。
