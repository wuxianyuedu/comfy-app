## Changed

- **代码块的样式从「渲染时注入」改为静态 CSS**：`studio/ui/CodeBlock` 的 `CODE_BLOCK_CSS` 此前以 `<style>{CODE_BLOCK_CSS}</style>` 的形式内联在渲染出的 JSX 里 —— 同样的 CSS 会随**每一次渲染**重新生成一个 style 元素（React 的 diff 认不出「内容没变、节点是新的」），代码分割后还可能被多份 chunk 各自注入。这段样式搬进 `src/app/globals.css`，类名（`cb-code-block` / `cb-line` / `cb-ln` / `cb-code`）与视觉逐字不变，纯搬迁。这违反的是自家规范 03 §3.5 / 反模式 T5，而**同一形态在本仓库已经犯过两次**（前一次是 `WorkflowEditorCanvas`，改完只留了注释说明）——所以这一次连判据一起机器化。

## Added

- **内联样式注入门禁**（`scripts/check-inline-style.cjs`，接入 pre-commit 与 CI）：`src/**` 里渲染出的 `<style>` 一律阻断（只有注释里解释历史写法的引用放行，因为那是口径本身）。「自己修完自己写注释」挡不住下一个人，这条把它变成可失败的断言。回归测试 `tests/check-inline-style.test.ts` 用临时仓库跑真脚本，断言该拦的拦、不该误伤的放过（注释引用、测试文件、`style={{…}}` 属性）。
