## Fixed

- **07 章面板那一串「审次」里，七条已经被代码推翻的陈述**（这一族此前只有拿代码复量才看得见，
  文档指向的类名/组件早不长那样了）：
  - §7.19.2 与 §7.21.2 都还在写**标题旁那块徽标**（`<来源> · <总数> · 警告 n · 错误 n`）是现状，
    而 §7.24.1 明写它**整块删除**（同一组 `originCounts` 说两遍，用户两轮都圈了它）—— 现在
    `LogPanelHeader.tsx` / `LogFilterBar.tsx` 里既没有 `rounded-full` 也没有徽标。§7.20.2 那一节
    （`w-8` + 标签上数字下）整节是「已被后续两轮取代」的自我订正史，删掉，现状由
    §7.23.2（整组 `flex-1`、同行）与 §7.24.3（`min-w-fit` + `w-[4ch]`）各自说一遍。
  - **§7.23.2 第三条写的是被否掉的那个值**：原文「`min-w-56` 是折行判据」，代码里
    `LogFilterBar.tsx` 的容器与按钮两侧都挂 `min-w-fit`，且 `LogPanel.test.tsx` 显式断言容器
    **不含** `min-w-56`（ISSUE #1695：`min-w-56` 允许容器压到 224px、五个按钮压不到自己的
    固有宽（约 406px）⇒ 容器比内容窄 ⇒ 溢出 16~174px 直接画到搜索框上；而 `flex-wrap` 判的是
    子项的 flex base size（`basis-0`）不是溢出内容，所以永不换行、只一直往外压）。照文档改回去
    会把这条事故重放一遍 —— 补上「为什么是 `min-w-fit`」与那条接线判据。
  - §7.22.1 的 DOM 顺序快照（`.h-12` 行头 + 徽标 + 一个 `flex-1` 空白）与那句「级别按钮与下拉
    之间的间距 > 120px」：`e2e/critical-flows.spec.ts` 里没有 120 这个数，量的是三者的
    `boundingBox().x` **顺序**（计数 < 搜索 < 下拉）。顺序不抄进文档，改成指代码这一处出处，
    只留下长期成立的那条约定（弹性空间必须排在搜索框之前）。
  - §7.27.4 与 §7.27.5 把选中态写成一份 `FILTER_SELECTED_STYLES` + `bg-primary/12`：实际有
    **两个导出**，挂在 `ToggleGroupItem` 上的是 `FILTER_SELECTED_ITEM_STYLES`，底色必须写
    **`bg-primary/12!`**（基元 `ui/toggle` 的 `data-pressed:bg-muted` 特异性 `(0,2,0)` 压过裸
    utility 的 `(0,1,0)`，不压就永远轮到基元生效，而它解析到 `--color-subtle` —— 正是这次要修的
    那个看不见）。用例断言的也是带 `!` 那一串。
- **两条「下一句就会被照抄」的测试接线订正**：
  - §7.20.5 原文「真正展开下拉的用例刻意只有一条且排在最后」——反了。`LogPanel.test.tsx:324`
    明写读候选内容的那几条**排在**「会把下拉打开着结束」那条**之前**（base-ui 的浮层树是模块级
    的、jsdom 不派发 `transitionend`，之后用例再点自己的下拉会点不开）。并补上 `afterEach` 为何
    不能写死等待轮数：轮询到 DOM 连续两轮不再变化才清 `body`。
  - §7.27.5 补一条判据写法红线：三层选中态**必须按类名 token 精确比对**，不许子串包含
    （`ui/toggle-group` 给每个 item 都挂 `data-pressed:ring-*` / `data-pressed:font-semibold`，
    子串会把未选中项判成「带着这三样」⇒ 假红，且真正要防的「选中没有区分度」反而被盖住）。
- **两处形态**：§7.21.2 删除后 §7.21.3 / §7.21.4 顺位补齐、§7.20.2 删除后 §7.20.3~6 顺位补齐
  （含两处内部引用同步）；§7.25 末尾那段属于 §7.26 的开篇（夹着一张与 §7.26.1 复述同一句的表）
  挪回 §7.26 标题之下，表删掉。
- **这一族仍然没有任何判据会红**：`check-doc-references.cjs` 的 C1 只核 AGENTS.md 的路径、
  C2 只核 `§NN.M` 锚点；文档指向类名、组件顺序、用例顺序与「哪个值是错的」既不解析代码也不
  解析用例。所以这批只能靠拿代码复量。
- 复算：`pnpm doc:check` 退 0（✓ 文档引用与权威源一致）、`pnpm doc:render` 后
  `docs/generated/07-日志系统.md` 与源同批（其余 30 份零漂移 ⇒ 渲染确定）、全章 markdown 表格
  行按列数逐行复量一致（无断行）、`§7.2x` 内部引用逐个对标题复算无悬空；
  `tests/audits-doc-references.test.ts` + `tests/check-doc-references.test.ts` +
  `tests/docs-candidate-hygiene.test.ts` + `tests/check-changelog-fragments.test.ts` 全绿。
