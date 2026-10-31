## Changed

oxlint `react/jsx-curly-brace-presence` 全仓清零（#2775）：29 处 / 16 份，全部是「花括号不必要」，fixer 一次收敛，0 手改。三类形态：

- 21 处 `{""}`——JSX 文本与内联元素之间的空表达式（`正在处理{""}<span>…`、`</kbd>{""}打开…`）；
- 3 处 props 上的字符串字面量：`value={"…"}` → `value="…"`（`WorkflowNodeArdot` 两处、`confirm-dialog.stories` 的 `description`）；
- 4 处 `{<CodeBlock {...args} />}` → `<CodeBlock {...args} />`（`code-block.stories`），1 处无插值的模板字面量 `className={`…`}` → `className="…"`（`SettingsView`）。

语义核对逐处做的是「`{""}` 两侧至少一边是元素或表达式」：这样删掉之后，换行不会落进同一个文本节点内部（JSX 会把文本内的换行压成一个空格，那才是唯一会改变渲染的地方）；21 处全部满足，其余四类只是去掉包着字符串字面量/元素的花括号。渲染文本不变。

oxfmt 把移除 `{""}` 后留下的空白行一并清掉（16 份）。

整条规则 0 命中（2405 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 103 份（固定 90 + 受影响 13）本地两段都跑绿（90/90、13/13）。
