## Changed

- **快照形态按 vitest 5 的口径归位（ISSUE #1485，第三件）**：三份 DOM 结构快照按规范 §11.9 全部迁成**行为断言**并删除 `.snap`，另给「大块且人读」的产物补上第一节 **`toMatchFileSnapshot`**。
  - `src/components/studio/FilmStudio.test.tsx`（49KB 的整棵 DOM dump）→ 按区块逐一断言用户可见结果（顶栏 / 预览区 / 分镜列表 / 时间轴与字幕轨 / 属性区各自的标题文案）+ 三个带可访问名的图标按钮（撤销 / 重做 / 新增镜头）+ 剧本输入框的 placeholder。整棵树的 dump 换成「坏了用户看得见的那几件事」。
  - `src/components/studio/canvas/WorkflowSubgraphNode.test.tsx` → 钉四条可感知的：子图身份标记（`S` 徽标 + 其 `title`）、折叠按钮的可访问名、标题的 `truncate`、`#id` 徽标带 `data-node-id-chip` 且标明子图变体（定位/调试靠它认行）。
  - `src/components/studio/workflow-editor/WorkflowEditorInner.test.tsx` → 从「dump 加载态的 div 树」改成钉 ISSUE #310 那条回归：全屏层必须让出标题行（`top-title-bar`）且**不得回到 `inset-0`**（那会盖掉窗口标题行里的页签、用户切不回去）。判据用带边界的正则而不是 `toContain` —— `bottom-0 left-0` 里也含 `top` 子串，`toContain` 那一版会假绿。
  - `tests/theme-tokens-compile-source.test.ts` 新增**文件快照**：`@theme` 声明的 149 个 token 清单落成 `tests/__snapshots__/theme-tokens.css-theme-surface.txt`。为什么不是内联数组：一次改名/删名之后**人真正想看的就是清单长什么样**，内联会把 149 行挤进 diff；文件快照把基线写成能独立打开、能单独 diff 的真产物。比对前先钉 `declared.size > 50` —— 解析规则失灵时「空清单照样通过」，那会是一条静默失效的清单。
  - 规范 11 §11.9 补齐「快照形态的选择」，新增 §11.9.1「文件快照：给『大块且人读』的产物用」（两类落点 + 三条边界，含「`-u` 要限范围，不带文件参数会把项目里所有快照一起写掉」这条实测踩到的坑）；`docs/guides/TESTING.md` 同步（该待办项关闭、`.snap` 存量清零）。
