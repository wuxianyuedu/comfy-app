## Fixed

- **a11y 那一档此前在渲一个 Storybook 里并不存在的形态**（`tests/a11y-axe-stories.test.ts`）。
  它把每个故事按 `createElement(meta.component, story.args)` 渲染，整个忽略了故事自己的
  `render`，也不合 `meta.args`。代价是**假覆盖与假噪音各一份**，实测差量逐条打出来之后：
  - `unrenderable` 从 57 条降到 20 条 —— 其中 **41 条本来就能渲**（`Default: Story = {}`
    这种「输入全在 meta 上」的故事此前拿到空 props 就抛错，被登记成「需要 provider」）；
    新登记 4 条 `command.tsx`，原因是**宿主缺 API**（jsdom 没有 `ResizeObserver`），
    不是故事写错了；
  - `violations` 从 11 条变 8 条，但**换掉的不是数字**：7 条（`button.tsx` / `disclosure.tsx`
    / `hint.tsx` / `native-select.tsx` / `option-list-popover.tsx` / `textarea.tsx`
    / `toggle.tsx` 的 `button-name` / `select-name` / `label`）是坏 harness 自己造出来的
    假存量 —— 裸组件拿不到 `children`，axe 当然报「按钮没有名字」；同时**露面 4 条真违规**
    （`button-group.tsx button-name`、`field.tsx aria-toggle-field-name`、
    `item.tsx aria-required-children`、`select.tsx button-name` ×7），那四条是这一档
    第一次真正判到的东西，已登进 `scripts/.a11y-axe-known.json` 当负债，不是新坏的。
    四条都**当场定过性**（判红消息现在带 axe 的 `failureSummary`）：`button-name` 那两族的
    原文是「Element does not have inner text that is visible to screen readers」——
    base-ui 的 `Select` 在**收起态且没给 `items`** 时，`SelectValue` 解析不出标签，
    触发器就是一颗没有名字的组合框按钮。那是 React 状态而不是绘制事实，真浏览器同形，
    所以记负债而不是当成 jsdom 误报。
  - 用户报的那三行 stderr 全部消失：`Received NaN for the value attribute`（`ui/slider`
    的受控 `value` 由 `render` 用 `defaultValue` 补，裸渲时 `clamp(undefined,0,100)` 出 NaN）、
    以及两条 `Not implemented`。
  渲染口径按 Storybook 自己的 `prepareStory`：`story.render ?? meta.render`，
  args 是 `{...meta.args, ...story.args}` 的浅合并；`argTypes[x].defaultValue` 那一档
  本仓为空，并**有判据正面盯着**（出现即红，不靠假设）。副作用式 / 空 `render` 现在记成
  渲不出来，而不是渲一棵空树让 axe 判「零违规」。
- **四份 ui 故事里为重抄 `args` 写的理由已经不成立**（`select-chip` / `section-label`
  / `display-density-toggle` / `service-status-row`）：那些注释写着「a11y 那一档不跑
  `render`、只喂 `story.args`」，判据改掉之后它们描述的是一个不存在的执行者。
  重抄本身留着（让每条故事自己站得住、Args 面板看得见初值），注释换成现在的事实。

## Changed

- **需要真实绘制的三条 axe 规则不再让 jsdom 判**（`PAINT_SCOPE_RULES_OFF`：
  `color-contrast` / `label-content-name-mismatch` / `link-in-text-block`）。理由逐条写在
  常量上：这三条要字体度量（canvas）、伪元素 `content`（`getComputedStyle(node, ':before')`）
  与真实布局，而 jsdom 三样都没有、这一档也不注入应用的样式表 —— 带着缺口去判的结果是
  `incomplete`，而本用例只收 `violations`，也就是**结构性的假通过**。判点说清落在哪儿：
  Storybook 的 a11y 面板（`@storybook/addon-a11y`，真浏览器 + CSS 生效）；
  「绘制层的 a11y 有没有机器执行者」这一格仍按空记在台账 E6，不在这里冒充覆盖。
  关掉的那份前提本身也有判据（一个 Tailwind 探针：class 落不进 computed style 才算成立）。
- **jsdom 能力缺口有了统一的处置入口**（`tests/helpers/jsdom-capability.ts`，接线在
  `tests/setup.ts`）：走 `VirtualConsole` 那条 `type: "not-implemented"` 的 `jsdomError`
  以前与真错误在 stderr 里逐字同形。现在按**整串相等**的白名单吞、其余按 jsdom 默认形态
  原样转发（含 `unhandled-exception` 打 `cause.stack` 那一支），并在每份文件结束时打出
  「吞了几条 / 为什么 / 这一档落在哪儿」。为什么不装原生 `canvas` 包让宿主「判得像真的」：
  它只补 `getContext` 一格，伪元素照旧没有，而那两格问的都是绘制事实。
  判据面在 `tests/jsdom-capability-gate.test.ts`（9 格，各钉一条吞/放的边界，
  含「近亲形状不许被吞」与「台账条目必须带理由与落点」）。
- **`每日单元测试` 挪到每日那一跑的最后一条**（业主口径：「最容易出问题的放最后，
  然后执行过的就不用重复执行了」）。CNB 的 stage 串行且失败即停，而这一格是那条流水线上
  唯一会因**这台机器的负载**而红的：`cnb-b0l-1k59op66t` 实测 775 份里只 1 份红，
  红在 `Test timed out in 30000ms`（同一时刻另有两份检出在这台 16 核机上跑全量 vitest
  与全量 eslint），而它后面三格全部 `skipped` —— 那三格至今零执行记录。顺序由
  `tests/no-platform-ci-config.test.ts` 新增那条钉住（变异证明：把锚点里两块换回来即红，
  且话术指名「要挪回中间先补超时指纹的隔离复跑」）。
