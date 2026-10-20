## Fixed

- **又一族「曾经真、现在不真」：文档点名的符号与文件形状。** 检索法：取台账文档里所有
  反引号包起来的标识符（3138 个），逐个对全代码树（`src` / `scripts` / `tools` / `tests` /
  `e2e` / `src-tauri` / `.storybook` / `.githooks`）取字面命中 —— 零命中的有 126 个，
  逐条读上下文后绝大多数是**框架/第三方名**（`GetWindowRect` / `WS_EX_TOPMOST` /
  `INSTDIR` / `assetPrefix` / `captureException` / `createUpdaterArtifacts` /
  `ERR_PNPM_*` / `codegraph` / `context7`）或**已自注的改名与删除记录**
  （`comfyDesktopManaged → 分区内 desktopManaged`、`DOM_TEST_GLOBS`「当时叫
  `JSDOM_TEST_GLOBS`」、`REQUIRED_CONFIG_FILES`「同批删除」、`ModalDialog`/`DarkSelect`
  那两行整条打了删除线）。真缺陷三条，本批改掉：
  - `docs/standards/07-日志系统.md` §7.30.1 写宽度档的单一出口是
    `~/components/ui/dialog-width`（**`PanelWidth`** 的 base …）。那个模块在、
    名字不对：现树导出的是 `modalWidth(base)` / `ModalWidth` / `MODAL_WIDE_WIDTH`。
    改成真名，并把那句「wide 统一 `calc(100vw-16px)`」跟着落到 `MODAL_WIDE_WIDTH` 这个
    唯一定义点上（原文没说是谁定义的）。
  - `docs/standards/17-UI与逻辑分离.md` §17.6.1 用现在时写
    「`WorkflowLibraryHelpers.tsx` … 647 行的文件只剩 `WorkflowIOThumb` /
    `RootGroupHeader` / `FilterTabs` / `PendingWorkflowCard` / `WorkflowListBody`
    五个纯 props 组件」——那份文件与那五个名字**全部不在树上**：工作流库后来按
    `src/components/studio/workflow-library/WorkflowLibrary*.tsx` 一文件一名拆开了。
    这一格留的是「纯函数 + 小组件混装为什么要拆」那个因，所以改成显式声明
    「这是当时的形状、不是文件清单」，并把找现状的落点写清（不抄新名单，抄一份就漂第二次）。
  - `docs/standards/04-组件设计.md` §4.1 是一张**逐组件写死行数**的现状表
    （`HistoryList` 600+ / 8 件事、`CanvasArea` 200+、`BottomBar` ~150、`HomePage` ~230、
    `LeftToolbar` ~100）。复算：`BottomBar` 与 `LeftToolbar` 两个名字整份不在树上；
    `HistoryList` 现 238 行（拆过），`CanvasArea` 现 303 行（长上去了）——
    **同一个快照里两个方向都在漂**。表删掉，只留判据（200 行 × 3 个功能 / 300 行无条件拆）
    与一条现量命令；那条命令带上了它自己的坑：`xargs` 在 606 个文件上会分批起 `wc`，
    每批各打一行 `total`，不 `grep -v " total$"` 就会把两条假读数排进结果里
    （实测：不滤时第一行是 `74456 total`）。
- **本批刻意没改的（判据还没拿到，拿猜测替换猜测比留着更坏）**，留给下一批：
  `scripts/build-desktop.mjs` 的 `STATIC_NOISE`（引用它的句子在
  `docs/standards/launch-and-build.md` §5 排障表里；这个名字在现树 grep 不到，
  剪枝那一步现在叫什么也没拿到等价判据）、16 章 §16.2.4 那份重复实现清单里的
  「项目产出 `STATUS_CHIP`」（16:1649；现树里 `ProjectOutputs.tsx` 用的是共享的
  `~/components/ui/status-badge` 的 `StatusBadge`，但那一行是不是「迁移前状态」的记法
  要读完那张表的图例才能定）、以及 `docs/standards/07-日志系统.md:475` 的
  `appendSorted`（真名应是 `log-timeline.ts` 的 `mergeTimeline` /
  `mergeTimelineIndexed`，要顺着那句「按 `seq` 合并批次」的上下文核）。
- **这一族同样没有任何判据会红**：`check-doc-references.cjs` 的 C1 只核 **AGENTS.md** 里
  的路径、C2 只核 `§NN.M` 标题锚点，文档正文里的符号名与文件形状不在判决面内。
  同批复算的两条**负结果**也一并记下来：文档点名的 `check-*.cjs` 里 7 个不在钩子文本中 ——
  5 个是被 `run-ast-gates.cjs` 聚合执行（文档写的就是「AST 判据聚合档」）、
  `check-bundle-budget.cjs` 的注册处是 `quality-gate.mjs` 的 `bundleBudget` 档与
  `pnpm build`、`check-standalone-contents.cjs` 的注册处是 `pnpm build` 收尾 ——
  都**不是**缺陷。⇒ 「判据的执行者脱钩」这一族在 batch1 之后已经没有残留。
- 复算：`pnpm doc:render` 后 `docs/generated/**` 与源同批；`check-doc-references.cjs` 退 0；
  `tests/check-doc-references.test.ts` / `tests/docs-candidate-hygiene.test.ts` 全绿。
