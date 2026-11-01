## Changed

oxlint `eslint/object-shorthand` 全仓清零（#2775）：6 处 / 4 份，全部是 `{ x: x }` → `{ x }` 的同名属性简写。

`workflow-io.ts` 的 `value: value`、`raw.ts` 的 `type: type`、`ErrorPanel.tsx` 的 `nodeId: nodeId`，以及 `.storybook/data-sources.tsx` 默认参数对象里的三个 `APP_DEV_*`。键名不变、值仍指向同一个绑定（默认参数对象里没有同名形参遮蔽），求值顺序不变。

fixer 一次收敛，0 手改。整条规则 0 命中（2405 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 225 份（固定 91 + 受影响 134）本地两段都跑绿（91/91、134/134）。
