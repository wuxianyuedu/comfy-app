## Changed

- **「可搜索列表过滤」八处各写一遍，收成 `~/lib/list-filter`**。这条账的形状不是「重复代码」，是**口径**：`AttributeMultiSelect` 只写了 `trim()` 而没折小写，其余七处写了 `trim().toLowerCase()` —— 两条都编译、都运行、类型都对，差别只在**含拉丁字母的候选能不能被小写关键字搜到**。而它真有影响：候选数据里就有 `JK制服` / `T恤` / `3D`，用户输 `jk` **一条也搜不到**。出口给 `normalizeNeedle` / `matchesNeedle` / `filterGroups`（**保组序 + 丢空组**，「可搜哪些字段」仍留在调用处）；迁移 `AttributeMultiSelect`（顺带修掉「全空才给未找到匹配项、中间空标题仍渲染」）与另外六处视图 / 逻辑层落点，以及 REST 路由与 tRPC 路由里同源的两段。
- **「一棵树的展开 / 收起」状态收成 `~/components/ui/expansion-set`**。`NodesTab` 一棵树用了三份同形 `Record<string, boolean>`，每份配一组逐字同形的 `setX((prev) => ({ ...prev, [k]: !prev[k] }))`，外加一段**逐字抄了两遍**的「补默认展开」。出口给 `isExpanded` / **`hasKey`**（表过态没 —— 与取值是两种判据）/ `toggle` / `set` / `seedDefaults`（**不覆盖已有表态**，无变化时返回原引用）/ `replace` / `collapseAll`。
- **「面板加宽档」三处各写一遍，收成 `~/components/ui/wide-panel`**，并补上三份**共同欠着的那件事**：`LogPanel` / `GlobalStepLogPanel` / `WorkflowRunLogModal` 都只写了 `useState`，**没有任何记忆** —— 用户加宽后关掉再打开又回到窄档。出口给 `useWidePanel`（`widthClass` 一处给出档位类，同一文件里那两处三元从此不可能不一致；记忆按 `id` 落 `localStorage`，走 `useSyncExternalStore` 与 `useCanvasSettings` 同机制）与 `WidePanelToggle`（`title` 与 `aria-label` 同源）。

## Added

- **P13 / P14 / P15 三条硬闸**（`scripts/check-ui-primitives.cjs`，`HARD_GATE_RULES`，不进棘轮基线），三条都**按形态取锚点**，且都写了反面用例（判据太宽会逼人改坏代码去迎合它）：
  - **P13** 搜索关键字归一化。**必须同时数「只 `trim()` 不折小写」那种写法** —— 它是这条账里更差的那一种，而它不含 `.trim().toLowerCase()`；判据漏掉更差的写法，被拦下的就永远只是合规者。豁免 `src/app/api/**`。
  - **P14** 展开集合翻转样板（`{ ...src, [key]: !src[key] }`，同一标识符既被展开、又是翻转的取值源）。参数名不写死（收口前那三处的形参名就是三种）；双条件必须同时成立，否则会把「在跑标记」这类非折叠语义的映射误判。
  - **P15** 加宽档三元（`<flag> ? <X>.wide : <X>.base`）。**不能数 `useState(false)`**，那会把正常弹窗开关全算进来。
- **出口侧契约**（`tests/ui-primitives-coverage.test.ts`）：三个新出口逐个断言「导出名在」「文件头写明替代了几份实现」「有业务引用」；`expansion-set` / `wide-panel` 钉住 `"use client"`。

## Fixed

- **`vitest.config.ts` 里两条静默失效的覆盖率门槛**：`src/components/ui/file-picker.tsx` 与 `ui/use-flash-state.ts` 写着一档门槛，却**不在 `coverage.include` 里** —— 阈值只对出现在报告里的文件生效，这两条于是挂了一整轮（写着 95/90/95/100，报告里查无此文件，`pnpm test --coverage` 也从不报错）。现在把四个 `ui/` 出口同批纳入 `include`，并为本批两个新出口按实测值设门槛（`expansion-set` 满档、`wide-panel` 90/95/90/70 —— 未覆盖的是 jsdom 到不了的 SSR 分支）。
