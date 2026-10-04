## Fixed

- **`react-hooks/exhaustive-deps` 的 disable 补齐原因注释**（`docs/standards/13` §13.1
  要求「单行 + 原因注释」）。本批不改任何依赖数组 —— 规范 §13.4 明写禁止「机械地照
  规则加减依赖」，要先判定属于哪一类。实测 13 处里 5 处的原因缺失或位置不统一，
  逐处判定后补齐：

  - **规则静态盲区（重算触发器）**
    `GlobalStepLogPanel.tsx`：`useMemo(() => listCachedTaskIds(), [logs, validationErrors, taskId])`
    里那三个依赖**不是** `listCachedTaskIds()` 真实读的输入（它读 `stepLogCache` 的
    模块级 Map），而是「什么时候该重算」的触发器。这条最值得写清：去掉任一条件会
    让任务选择器停在旧清单上且不会自愈。
  - **规则静态盲区（按 id 触发）**
    `use-workflow-graph-derivation.ts`：`workflowId` 是 effect 体里读了的、却不在
    依赖里 —— 它随 `detail` 一起变（loader 以它为键取详情），单独挂它反而会在详情
    尚未落地时先把 store 里的 id 改掉。
    `use-workflow-io.ts` 两处（`patch` 是稳定引用 / `d` 是渲染期新对象）。
    `use-workflow-detail-loader.ts`：`fetchDetail` 与四个 setter 都是 `useCallback`
    稳定引用，挂上不改变触发时机。
  - **首挂载初始化**
    `ProjectCanvas.tsx`：原先是**唯一一处连原因都没有**的裸 disable。补上「为什么
    不能挂完整依赖」——挂上会让每次节点变动重跑整段水合，把用户刚拖的位置覆盖回
    库里的旧值。

  顺带把 `use-workflow-detail-loader.ts` 的 `// eslint-disable-line` 行内形态改成
  `-next-line`，与其余 12 处统一（`reportUnusedDisableDirectives` 下同效，
  但行内形态在位次判断上更易读错）。
