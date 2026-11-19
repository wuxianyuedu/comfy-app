## Fixed

- **把 `typescript/no-unnecessary-type-arguments` 的误导性提示写成可复算口径，不再靠每个调用点先崩一次类型才发现（ISSUE #3441）**：`useEdgesState<Edge>([])` 被提示「`Edge` 是该类型参数的默认值，可以省略」，真省略后 `[]` 把 `EdgeType` 反推成 `never`，`setEdges` 收 `SetStateAction<never[]>`，之后塞 `Edge[]` 全线报错。规则只比「显式实参 == 默认值」，看不见推断位置，对 `f<T = Default>([])` 恒偏。§13.5.32 新增三夹具读数（TypeScript 7.0.2 / oxlint 1.90.0）：`with-arg` 规则 1 命中 / tsc 绿、`no-arg` 规则 0 命中 / tsc `TS2345`、`typed-initial` 两边全绿；并写清点目录会被 TS 的 `**/*.ts(x)` glob 跳过、夹具放错会得到假绿。
- **本仓拍板写法与复评触发落档**：`const initialEdges: Edge[] = [];` + `useEdgesState(initialEdges)`——不带类型参数、不带类型断言、不加 disable，规则不报且 `EdgeType` 确实推成 `Edge`。两处现场 `src/components/studio/ProjectCanvas.tsx` / `src/components/studio/workflow-editor/WorkflowEditorInner.tsx` 已由 #3403 按此形态落地。上游把「默认值 + 空数组实参」纳入判断、或 `@xyflow/react` 改变类型参数推断方式时，重跑三夹具再撤编本段。
- **规则面与探针清单都不动**：规则实现在上游 oxlint、不在仓里；给 `ZERO_RULES` 探针加「按调用点形状豁免」要另写一套 AST 扫描器，正是硬规则 24 末句与 `AGENTS.md`「遇到代码怪癖：当场立案，不就地绕开」那节明禁的「新造判据抓怪癖」。只在 `scripts/check-oxlint-zero-rules.mjs` 文件头补一条指向 §13.5.32 的口径，`ZERO_RULES` 仍是纯规则名清单。
- **文档源与生成态镜像同批**：`docs/standards/13-提交与-code-review.md` ⇄ `docs/generated/13-提交与-code-review.md`。边界：不动 `pnpm run lint` 判决口、不动 41 条已清零规则集、不动两处调用点、不新增判据脚本。
