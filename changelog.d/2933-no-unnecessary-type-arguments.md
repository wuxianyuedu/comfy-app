## Changed

- oxlint `typescript/no-unnecessary-type-arguments` 全仓清零（#2933）：18 处 / 13 份，
  删掉的都是与泛型默认值相同的实参（`SegmentSection<string>` → `SegmentSection`、
  `WeakSet<object>` → `WeakSet()`、`ValueHandler<string>` → `ValueHandler`、
  `OnEdgesChange<Edge>` / `OnNodesChange<Node>` 去掉形参）。
- 例外 2 处落台账禁用：`useEdgesState<Edge>([])`（`ProjectCanvas.tsx`、
  `WorkflowEditorInner.tsx`）的泛型靠显式实参推断，删掉会退化成 `never[]`。
- 该规则带类型信息（tsgolint），单规则自查须用去掉 `options: {}` 的
  `.git/oxlint-one-rule-typed.mjs`，否则会报「0 rules」的假零。
